import {
  reserveTickets,
  getTicketInfo,
  generateTicketsPDF,
} from "../controllers/orderController.js";

import express from "express";

const router = express.Router();

router.post("/reserve", reserveTickets);
router.get("/:encryptedOrderId/pdf", generateTicketsPDF);
router.get("/:encryptedOrderId/:slugId", getTicketInfo);

export default router;
