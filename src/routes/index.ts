import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scoresRouter from "./scores";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scoresRouter);
router.use(adminRouter);

export default router;
