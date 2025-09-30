import { verifyToken } from "../services/jwtService.js";
import { decrypt } from "../services/cryptoService.js";

export const authenticateReservationToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      error: "Access token required",
      code: "NO_TOKEN",
    });
  }

  try {
    const user = verifyToken(token);

    if (user.role !== "reservation_admin") {
      return res.status(403).json({
        error: "Invalid token role for reservation management",
        code: "INVALID_ROLE",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({
      error: "Invalid or expired token",
      code: "INVALID_TOKEN",
    });
  }
};

export const validateBookingAccess = (req, res, next) => {
  try {
    const { bookingId } = req.params;

    if (!bookingId) {
      return res.status(400).json({
        error: "Booking ID is required",
      });
    }

    let realBookingId;
    try {
      realBookingId = decrypt(bookingId);
    } catch (decryptError) {
      return res.status(400).json({
        error: "Invalid booking ID format",
      });
    }

    if (req.user.bookingId !== realBookingId) {
      return res.status(403).json({
        error: "Token does not match this booking",
        code: "BOOKING_MISMATCH",
        debug: {
          tokenBookingId: req.user.bookingId,
          requestBookingId: realBookingId,
        },
      });
    }

    req.realBookingId = realBookingId;
    next();
  } catch (error) {
    console.log("8. Validation error:", error.message);
    return res.status(500).json({
      error: "Error validating booking access",
      details: error.message,
    });
  }
};
