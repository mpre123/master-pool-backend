import { logger } from './logger.js'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = join(__dirname, '../../sync-state.json')
const MASTERS_EVENT_ID = '401811941'
const SYNC_INTERVAL_MS = 5 * 60 * 1000 // every 5 minutes

// Load persisted event ID from disk (survives deploys, not server restarts on Replit)
function loadEventId(): string {
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8')
    return JSON.parse(raw).eventId ?? MASTERS_EVENT_ID
  } catch {
    return MASTERS_EVENT_ID
  }
}

function saveEventId(id: string) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ eventId: id }), 'utf-8')
  } catch {
    // non-fatal
  }
}

let activeEventId = loadEventId()

export function setActiveEventId(id: string) {
  activeEventId = id
  saveEventId(id)
  logger.info({ eventId: id }, 'Score sync: event ID updated')
}

type ESPNCompetitor = {
  athlete: { displayName: string }
  score: { value: number; displayValue: string }
  status: { type: { name: string } }
  statistics: Array<{ name: string; value: number; displayValue: string }>
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ')
}

function matchName(espnName: string, dbNames: string[]): string | null {
  const normalized = normalizeName(espnName)
  for (const n of dbNames) {
    if (normalizeName(n) === normalized) return n
  }
  const espnParts = normalized.split(' ')
  const espnLast = espnParts[espnParts.length - 1]
  for (const n of dbNames) {
    const dbParts = normalizeName(n).split(' ')
    const dbLast = dbParts[dbParts.length - 1]
    if (espnLast === dbLast) return n
  }
  return null
}

function isDuringTournamentHours(): boolean {
  const now = new Date()
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const hour = eastern.getHours()
  return hour >= 7 && hour < 19
}

async function fetchLeaderboard(eventId: string): Promise<ESPNCompetitor[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga&event=${eventId}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MastersPool/1.0' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`ESPN API returned ${res.status}`)
  const data = await res.json() as { events?: Array<{ competitions?: Array<{ competitors?: ESPNCompetitor[] }> }> }
  return data.events?.[0]?.competitions?.[0]?.competitors ?? []
}

async function syncScores(eventId: string) {
  if (!isDuringTournamentHours()) {
    logger.info('Score sync skipped — outside tournament hours (7am-7pm ET)')
    return
  }

  const supabaseUrl = process.env['SUPABASE_URL']
  const serviceKey  = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!supabaseUrl || !serviceKey) {
    logger.warn('Score sync skipped: env vars missing')
    return
  }

  try {
    const playersRes = await fetch(`${supabaseUrl}/rest/v1/players?select=id,name,score,missed_cut`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    })
    if (!playersRes.ok) throw new Error(`Supabase players fetch failed: ${playersRes.status}`)
    const dbPlayers = await playersRes.json() as Array<{ id: string; name: string; score: number | null; missed_cut: boolean }>

    if (dbPlayers.length === 0) {
      logger.info('Score sync: no players in DB — skipping')
      return
    }

    const competitors = await fetchLeaderboard(eventId)
    if (competitors.length === 0) {
      logger.info('Score sync: no competitors from ESPN (tournament may not have started)')
      return
    }

    const dbNameList = dbPlayers.map(p => p.name)
    let updatedCount = 0
    let skippedCount = 0

    for (const competitor of competitors) {
      const espnName = competitor.athlete?.displayName
      if (!espnName) continue
      const dbName = matchName(espnName, dbNameList)
      if (!dbName) { skippedCount++; continue }
      const dbPlayer = dbPlayers.find(p => p.name === dbName)
      if (!dbPlayer) continue

      const scoreToParStat = competitor.statistics?.find(s => s.name === 'scoreToPar')
      const rawScore = scoreToParStat?.value ?? competitor.score?.value ?? 0
      const statusName = competitor.status?.type?.name ?? ''
      const missedCut = statusName === 'STATUS_CUT' ||
                        statusName === 'STATUS_ELIMINATED' ||
                        statusName === 'STATUS_DISQUALIFIED' ||
                        statusName === 'STATUS_WITHDRAWN'

      if (statusName === 'STATUS_SCHEDULED' && rawScore === 0) continue
      if (dbPlayer.score === rawScore && dbPlayer.missed_cut === missedCut) continue

      const updateRes = await fetch(`${supabaseUrl}/rest/v1/players?id=eq.${dbPlayer.id}`, {
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ score: rawScore, missed_cut: missedCut }),
      })

      if (!updateRes.ok) {
        logger.error({ name: dbName, status: updateRes.status }, 'Failed to update player score')
      } else {
        updatedCount++
        logger.info({ name: dbName, score: rawScore, missedCut }, 'Score updated')
      }
    }

    logger.info({ updatedCount, skippedCount, eventId }, 'Score sync complete')
  } catch (err) {
    logger.error({ err }, 'Score sync error')
  }
}

export function startScoreSync() {
  logger.info({ eventId: activeEventId }, 'Score sync: initialized — will auto-sync every 5 min during tournament hours (7am-7pm ET)')

  // Run immediately on startup
  void syncScores(activeEventId)

  // Auto-sync every 5 minutes
  setInterval(() => {
    void syncScores(activeEventId)
  }, SYNC_INTERVAL_MS)
}

export async function triggerSyncNow(eventId?: string) {
  const id = eventId ?? activeEventId
  if (eventId) setActiveEventId(eventId)
  logger.info({ eventId: id }, 'Manual score sync triggered')
  await syncScores(id)
  return { ok: true, timestamp: new Date().toISOString(), eventId: id }
}
