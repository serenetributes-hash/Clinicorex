import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes";
import patientRoutes from "./routes/patients.routes";
import encounterRoutes from "./routes/encounters.routes";
import queueRoutes from "./routes/queue.routes";
import inventoryRoutes from "./routes/inventory.routes";
import theatreRoutes from "./routes/theatre.routes";
import wardRoutes from "./routes/wards.routes";
import reportRoutes from "./routes/reports.routes";
import catalogRoutes from "./routes/catalog.routes";
import settingsRoutes from "./routes/settings.routes";

const app = express();

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim().replace(/\/+$/, ""))
  : "*";

console.log("CORS allowed origins:", corsOrigin);

const corsOptions: cors.CorsOptions = { origin: corsOrigin };

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // explicit preflight handling
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRoutes);
app.use("/patients", patientRoutes);
app.use("/encounters", encounterRoutes);
app.use("/queue", queueRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/theatre", theatreRoutes);
app.use("/wards", wardRoutes);
app.use("/reports", reportRoutes);
app.use("/catalog", catalogRoutes);
app.use("/settings", settingsRoutes);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`Clinicore API listening on port ${port}`));
