import { decrypt } from "../services/cryptoService.js";
import { supabase } from "../services/supabaseClient.js";

import express from "express";

const router = express.Router();

router.post("/validate-ticket", async (req, res) => {
  try {
    const { qr_token, venue_id, organization_id } = req.body;

    if (!qr_token || !venue_id || !organization_id) {
      return res.status(400).json({
        error: "QR token, venue ID, and organization ID are required",
      });
    }

    const cleanToken = decrypt(qr_token.trim());

    // Consulta robusta, nombres corregidos
    const { data: ticketData, error: ticketError } = await supabase
      .from("tickets")
      .select(
        `
        id,
        validated_at,
        events!tickets_event_id_fkey (
          name,
          organization_id,
          venue_id
        ),
        ticket_types!tickets_ticket_type_id_fkey (
          name
        )
      `
      )
      .eq("qr_token", cleanToken)
      .single();

    if (ticketError || !ticketData) {
      return res.status(404).json({
        error: "Invalid QR code. Ticket not found",
      });
    }
    if (!ticketData.events) {
      return res.status(404).json({ error: "Event missing from ticket" });
    }
    if (!ticketData.ticket_types) {
      return res.status(404).json({ error: "Ticket type missing from ticket" });
    }

    if (ticketData.validated_at !== null) {
      return res.status(400).json({
        error: "Ticket already validated",
        details: `This ticket was already validated`,
      });
    }

    if (ticketData.events.organization_id !== decrypt(organization_id)) {
      return res.status(403).json({
        error: "Access denied. Invalid organization",
      });
    }

    if (ticketData.events.venue_id !== decrypt(venue_id)) {
      return res.status(403).json({
        error: "Access denied. Invalid venue",
      });
    }

    const { error: updateError } = await supabase
      .from("tickets")
      .update({ validated_at: new Date().toISOString() })
      .eq("id", ticketData.id);

    if (updateError) {
      return res.status(500).json({
        error: "Failed to validate ticket",
      });
    }

    res.json({
      success: true,
      message: "Ticket validated successfully",
      event_name: ticketData.events.name,
      ticket_type: ticketData.ticket_types.name,
    });
  } catch (err) {
    console.error("Ticket validation error:", err.message);
    console.error(err.stack);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});

export default router;
