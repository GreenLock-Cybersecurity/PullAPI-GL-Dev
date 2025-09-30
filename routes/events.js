import express from "express";
const router = express.Router();
import { supabase } from "../services/supabaseClient.js";
import { encrypt, decrypt } from "../services/cryptoService.js";
import { authenticateToken } from "../middleware/auth.js";

router.get("/get-all-events", async (req, res) => {
  try {
    const { data: eventsData, error: eventsError } = await supabase
      .from("events")
      .select(
        "id, slug, venue_id, image, name, start_time, end_time, event_date, custom_location, requirements"
      );

    if (eventsError) {
      console.error("Error al obtener eventos:", eventsError.message);
      return res.status(500).json({ error: "Error al obtener eventos" });
    }

    const response = await Promise.all(
      eventsData.map(async (event) => {
        const { data: venueData, error: venueError } = await supabase
          .from("venues")
          .select("name")
          .eq("id", event.venue_id)
          .single();

        if (venueError) {
          console.error(
            "Error al obtener el nombre del lugar:",
            venueError.message
          );
          return res
            .status(500)
            .json({ error: "Error al obtener nombre del lugar" });
        }

        return {
          event_id: encrypt(event.id),
          event_slug: event.slug,
          event_img: event.image,
          event_name: event.name,
          venue_name: venueData ? venueData.name : null,
          start_time: event.start_time,
          end_time: event.end_time,
          event_date: event.event_date,
          custom_location: event.custom_location,
          requirements: event.requirements || [],
        };
      })
    );

    res.json(response.filter((e) => e !== null));
  } catch (err) {
    console.error("Error al obtener eventos:", err.message);
    res.status(500).json({ error: "Error al obtener eventos" });
  }
});

router.get("/get-detailed-event-info/:eventSlugId", async (req, res) => {
  try {
    const slugId = req.params.eventSlugId;

    const { data: eventData, error: eventError } = await supabase
      .from("events")
      .select(
        "name, venue_id, image, event_date, start_time, end_time, custom_location, requirements"
      )
      .eq("slug", slugId)
      .single();

    if (eventError || !eventData) {
      console.error("Error al obtener el evento:", eventError?.message);
      return res.status(404).json({ error: "Evento no encontrado" });
    }

    const { data: venueData, error: venueError } = await supabase
      .from("venues")
      .select("name")
      .eq("id", eventData.venue_id)
      .single();

    if (venueError || !venueData) {
      console.error("Error al obtener el venue:", venueError?.message);
      return res.status(404).json({ error: "Venue no encontrado" });
    }

    const response = {
      event_name: eventData.name,
      event_img: eventData.image,
      date: eventData.event_date,
      open_time: eventData.start_time,
      close_time: eventData.end_time,
      location: venueData.name,
      requirements: eventData.requirements || [],
    };

    res.json(response);
  } catch (err) {
    console.error("Error general al obtener el evento:", err.message);
    res.status(400).json({ error: "ID inválido o error en la consulta" });
  }
});

router.get("/get-tickets-types/:eventSlugId", async (req, res) => {
  try {
    const slugId = req.params.eventSlugId;

    const { data: eventData, error: eventError } = await supabase
      .from("events")
      .select("id")
      .eq("slug", slugId)
      .single();
    if (eventError || !eventData) {
      console.error("Error al obtener el evento:", eventError?.message);
      return res.status(404).json({ error: "Evento no encontrado" });
    }

    const realEventId = eventData.id;

    const { data, error } = await supabase
      .from("ticket_types")
      .select("id, name, price, benefits, available_quantity")
      .eq("event_id", realEventId);

    if (error) {
      console.error("Error al obtener tipos de ticket:", error.message);
      return res
        .status(500)
        .json({ error: "Error al obtener tipos de ticket" });
    }

    const response = data.map((ticket) => ({
      ticket_type_id: encrypt(ticket.id),
      slug: slugId,
      ticket_name: ticket.name,
      ticket_price: ticket.price,
      ticket_description: ticket.benefits || [],
      ticket_quantity: ticket.available_quantity,
    }));

    res.json(response);
  } catch (err) {
    console.error("Error al procesar ticket types:", err.message);
    res.status(400).json({ error: "ID inválido o error en la consulta" });
  }
});

router.get("/get-event-info/:eventSlugId", async (req, res) => {
  try {
    const slugId = req.params.eventSlugId;

    const { data, error } = await supabase
      .from("events")
      .select("name, image, event_date, start_time, end_time, custom_location")
      .eq("slug", slugId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Evento no encontrado" });
    }

    res.json({
      event_name: data.name,
      event_img: data.image,
      date: data.event_date,
      open_time: data.start_time,
      close_time: data.end_time,
      location: data.custom_location,
    });
  } catch (err) {
    console.error("Error al obtener info de evento:", err.message);
    res.status(400).json({ error: "ID inválido o error en la consulta" });
  }
});

router.get("/get-ticket-info/:eventSlug/:ticketId", async (req, res) => {
  try {
    const eventSlug = req.params.eventSlug;
    const encryptedTicketId = req.params.ticketId;
    const realTicketId = decrypt(encryptedTicketId);

    const { data: eventData, error: eventError } = await supabase
      .from("events")
      .select("id")
      .eq("slug", eventSlug)
      .single();

    if (eventError || !eventData) {
      return res
        .status(404)
        .json({ error: "Evento no encontrado para este slug" });
    }

    const { data, error } = await supabase
      .from("ticket_types")
      .select("name, price, available_quantity, benefits, expenses")
      .eq("id", realTicketId)
      .eq("event_id", eventData.id)
      .single();

    if (error) {
      console.error("Error de Supabase al buscar el ticket:", error.message);
      return res
        .status(500)
        .json({ error: "Error al obtener ticket", detail: error.message });
    }

    if (!data) {
      console.warn("Ticket no encontrado para ID:", realTicketId);
      return res.status(404).json({ error: "Ticket no encontrado" });
    }

    res.json({
      ticket_name: data.name,
      ticket_price: data.price,
      ticket_description: data.benefits || [],
      ticket_quantity: data.available_quantity,
      ticket_expenses: data.expenses || 0,
    });
  } catch (err) {
    console.error("Error al obtener ticket info:", err.message);
    res.status(400).json({ error: "ID inválido o error en la consulta" });
  }
});

router.get("/upcoming-events/:venue_id", async (req, res) => {
  try {
    const { venue_id } = req.params;

    if (!venue_id) {
      return res.status(400).json({
        error: "Venue ID is required",
      });
    }

    const realVenueId = decrypt(venue_id);

    const { data: events, error } = await supabase
      .from("events")
      .select(
        `
        id,
        name,
        image,
        event_date,
        start_time,
        end_time,
        ticket_limit,
        tickets (id)
      `
      )
      .eq("venue_id", realVenueId)
      .gte("event_date", new Date().toISOString().split("T")[0])
      .order("event_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(5);

    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({
        error: "Failed to fetch events",
      });
    }

    const processedEvents = events.map((event) => ({
      id: encrypt(event.id),
      name: event.name,
      image: event.image,
      event_date: event.event_date,
      start_time: event.start_time,
      end_time: event.end_time,
      ticket_limit: event.ticket_limit,
      tickets_sold: event.tickets ? event.tickets.length : 0,
      tickets_available: event.ticket_limit
        ? event.ticket_limit - (event.tickets ? event.tickets.length : 0)
        : null,
    }));

    res.json({
      success: true,
      events: processedEvents,
      total_events: processedEvents.length,
    });
  } catch (err) {
    console.error("Server error:", err.message);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.get("/get-event-details/:event_id", async (req, res) => {
  try {
    const { event_id } = req.params;

    if (!event_id) {
      return res.status(400).json({
        error: "Event ID is required",
      });
    }

    const realEventId = decrypt(event_id);

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select(
        `
        id,
        name,
        description,
        image,
        event_date,
        start_time,
        end_time,
        ticket_limit,
        min_age,
        dress_code,
        custom_location,
        access_type,
        requirements,
        event_types!events_access_type_fkey (
          type
        ),
        ticket_types (
          id,
          name,
          price,
          initial_quantity,
          available_quantity,
          benefits,
          expenses
        )
      `
      )
      .eq("id", realEventId)
      .single();

    if (eventError || !event) {
      return res.status(404).json({
        error: "Event not found",
      });
    }

    // Obtener conteo de tickets vendidos por tipo
    const { data: ticketCounts, error: countsError } = await supabase
      .from("tickets")
      .select("ticket_type_id")
      .eq("event_id", realEventId);

    if (countsError) {
      console.error("Error counting tickets:", countsError);
    }

    // Calcular tickets vendidos por tipo
    const ticketCountsByType = {};
    if (ticketCounts) {
      ticketCounts.forEach((ticket) => {
        ticketCountsByType[ticket.ticket_type_id] =
          (ticketCountsByType[ticket.ticket_type_id] || 0) + 1;
      });
    }

    // Procesar tipos de ticket con conteos
    const processedTicketTypes = event.ticket_types.map((ticketType) => ({
      id: encrypt(ticketType.id),
      name: ticketType.name,
      price: ticketType.price,
      description: ticketType.benefits || `${ticketType.name} ticket`,
      max: ticketType.initial_quantity,
      commission: ticketType.expenses || 0,
      sold: ticketCountsByType[ticketType.id] || 0,
      available: ticketType.available_quantity,
    }));

    // Calcular total de tickets vendidos
    const totalTicketsSold = Object.values(ticketCountsByType).reduce(
      (sum, count) => sum + count,
      0
    );

    const processedEvent = {
      id: encrypt(event.id),
      name: event.name,
      description: event.description,
      poster: event.image,
      date: event.event_date,
      startTime: event.start_time,
      endTime: event.end_time,
      accessType: event.event_types?.type || "public",
      minAge: event.min_age,
      maxTickets: event.ticket_limit,
      ticketsSold: totalTicketsSold,
      dressCode: event.dress_code,
      customLocation: event.custom_location,
      requirements: event.requirements,
      ticketTypes: processedTicketTypes,
    };

    res.json({
      success: true,
      event: processedEvent,
    });
  } catch (err) {
    console.error("Server error:", err.message);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});

export default router;
