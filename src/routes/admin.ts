import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

function getSupabaseConfig() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("Supabase env vars missing");
  return { url, key };
}

// Verify the request JWT belongs to an admin user
async function verifyAdmin(authHeader: string | undefined): Promise<boolean> {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  const { url, key } = getSupabaseConfig();

  // Get user from the JWT
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: key },
  });
  if (!userRes.ok) return false;
  const userData = await userRes.json() as { id?: string };
  if (!userData.id) return false;

  // Check is_admin in users table
  const dbRes = await fetch(
    `${url}/rest/v1/users?id=eq.${userData.id}&select=is_admin`,
    { headers: { Authorization: `Bearer ${key}`, apikey: key } }
  );
  if (!dbRes.ok) return false;
  const rows = await dbRes.json() as Array<{ is_admin: boolean }>;
  return rows[0]?.is_admin === true;
}

// DELETE /api/admin/users/:id  — fully removes a user so they can re-register
router.delete("/admin/users/:id", async (req, res) => {
  try {
    const isAdmin = await verifyAdmin(req.headers.authorization);
    if (!isAdmin) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "Missing user id" });
      return;
    }

    const { url, key } = getSupabaseConfig();
    const headers = { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };

    // 1. Delete their picks/entry rows
    await fetch(`${url}/rest/v1/entries?user_id=eq.${id}`, { method: "DELETE", headers });

    // 2. Delete from users table
    await fetch(`${url}/rest/v1/users?id=eq.${id}`, { method: "DELETE", headers });

    // 3. Delete from Supabase Auth so they can re-register with the same email
    const authDel = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers });
    if (!authDel.ok) {
      const body = await authDel.text();
      logger.warn({ id, status: authDel.status, body }, "Could not delete auth user");
    }

    logger.info({ id }, "Admin deleted user");
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Error deleting user");
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/admin/players  — removes all players (for switching tournaments)
router.delete("/admin/players", async (req, res) => {
  try {
    const isAdmin = await verifyAdmin(req.headers.authorization);
    if (!isAdmin) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { url, key } = getSupabaseConfig();
    const headers = { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };

    // Delete all players (cascades to entry_picks via FK)
    const result = await fetch(`${url}/rest/v1/players?id=neq.00000000-0000-0000-0000-000000000000`, {
      method: "DELETE",
      headers,
    });

    if (!result.ok) {
      const body = await result.text();
      logger.warn({ status: result.status, body }, "Could not delete all players");
      res.status(500).json({ error: "Failed to delete players" });
      return;
    }

    logger.info("Admin cleared all players");
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Error clearing players");
    res.status(500).json({ error: String(err) });
  }
});

export default router;
