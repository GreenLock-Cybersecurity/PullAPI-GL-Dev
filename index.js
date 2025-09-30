import "dotenv/config";
import express from "express";
import cors from "cors";

// Importar todas las rutas modulares
import venuesRoutes from "./routes/venues.js";
import eventRoutes from "./routes/events.js";
import orderRoutes from "./routes/orders.js";
import authRoutes from "./routes/auth.js";
import ticketsValidationRoutes from "./routes/ticketsValidation.js";
import bookingRoutes from "./routes/bookings.js";

const app = express();

// Configuración de CORS
app.use(
  cors({
    origin: true,
  })
);

app.use(express.json());

// Ruta de verificación
app.get("/", (req, res) => {
  res.json({
    message: "API funcionando correctamente en Vercel",
    version: "1.0.0",
    endpoints: {
      venues: "/api/v1/venues/*",
      events: "/api/v1/event/*",
      orders: "/api/v1/orders/*",
      auth: "/api/v1/auth/*",
      tickets: "/api/v1/tickets/*",
      bookings: "/api/v1/bookings/*",
    },
  });
});

// Montar todas las rutas modulares
app.use("/api/v1/venues", venuesRoutes);
app.use("/api/v1/event", eventRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/tickets", ticketsValidationRoutes);
app.use("/api/v1/bookings", bookingRoutes);

// Solo ejecutar servidor local en desarrollo
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`Servidor escuchando en http://0.0.0.0:${port}`);
    console.log(`También disponible en tu IP local en puerto ${port}`);
  });
}

// Exportar para Vercel
export default app;
