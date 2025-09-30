import express from "express";
import { supabase } from "../services/supabaseClient.js";
import { encrypt } from "../services/cryptoService.js";
import { generateToken } from "../services/jwtService.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

router.post("/login-workers", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required",
      });
    }

    const { data: workerData, error: workerError } = await supabase
      .from("organization_workers")
      .select(
        `
        id,
        email,
        password_hash,
        first_name,
        last_name,
        organization_id,
        venue_id,
        roles!organization_workers_role_fkey (
          type
        )
      `
      )
      .eq("email", email.trim())
      .is("deleted_at", null)
      .single();

    if (workerError || !workerData) {
      return res.status(401).json({
        error: "Invalid email or password. Please check your credentials",
      });
    }

    if (password !== workerData.password_hash) {
      return res.status(401).json({
        error: "Invalid email or password. Please check your credentials",
      });
    }

    // Preparar payload para JWT
    const jwtPayload = {
      employee_id: workerData.id,
      organization_id: workerData.organization_id,
      venue_id: workerData.venue_id,
      role: workerData.roles?.type,
      email: workerData.email,
      name: `${workerData.first_name} ${workerData.last_name}`,
    };

    // Generar JWT
    const token = generateToken(jwtPayload);

    const response = {
      user: {
        id: encrypt(workerData.id),
        name: `${workerData.first_name} ${workerData.last_name}`,
        email: workerData.email,
        role: workerData.roles?.type,
        organization_id: encrypt(workerData.organization_id),
        venue_id: encrypt(workerData.venue_id),
      },
      token,
      message: "Login successful",
    };

    res.json(response);
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({
      error: "Internal server error. Please try again later",
    });
  }
});

router.post("/refresh-token", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: "Token is required",
      });
    }

    const newToken = refreshToken(token);

    res.json({
      token: newToken,
      message: "Token refreshed successfully",
    });
  } catch (error) {
    res.status(403).json({
      error: "Unable to refresh token",
    });
  }
});

router.get("/verify-token", authenticateToken, (req, res) => {
  res.json({
    valid: true,
    user: {
      id: encrypt(req.user.employee_id),
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      organization_id: encrypt(req.user.organization_id),
      venue_id: encrypt(req.user.venue_id),
    },
  });
});

export default router;
