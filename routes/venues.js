import { encrypt, decrypt } from "../services/cryptoService.js";
import { supabase } from "../services/supabaseClient.js";
import { dpiUpsertAndGetId } from "../utils/userUtils.js";

import express from "express";

const router = express.Router();

router.get("/get-all-venues", async (req, res) => {
  const { data, error } = await supabase
    .from("venues")
    .select("id, slug, name, image, open_time, close_time, location");

  if (error) {
    return res.status(500).json({ error: "Error al obtener los venues" });
  }

  const response = data.map((venue) => ({
    id: encrypt(venue.id.toString()),
    slug: venue.slug,
    venue_name: venue.name,
    image: venue.image,
    open_time: venue.open_time,
    close_time: venue.close_time,
    location: venue.location,
  }));

  res.json(response);
});

router.get("/events/get-all-events/:slugId", async (req, res) => {
  try {
    const venueSlug = req.params.slugId;
    const takeNumber = parseInt(req.query.takeNumber) || 10;

    const { data: venueData, error: venueError } = await supabase
      .from("venues")
      .select("id, name")
      .eq("slug", venueSlug)
      .single();

    if (venueError || !venueData) {
      console.error("Error al obtener el venue por slug:", venueError?.message);
      return res.status(404).json({ error: "Venue no encontrado" });
    }

    const realVenueId = venueData.id;

    const { data: eventsData, error: eventsError } = await supabase
      .from("events")
      .select(
        "id, slug, venue_id, image, name, start_time, end_time, event_date, custom_location, requirements"
      )
      .eq("venue_id", realVenueId)
      .order("event_date", { ascending: false })
      .limit(takeNumber);

    if (eventsError) {
      console.error("Error al obtener eventos:", eventsError.message);
      return res.status(500).json({ error: "Error al obtener los eventos" });
    }

    const response = eventsData.map((event) => ({
      event_id: encrypt(event.id),
      event_slug: event.slug,
      event_img: event.image,
      event_name: event.name,
      venue_name: venueData.name,
      start_time: event.start_time,
      end_time: event.end_time,
      event_date: event.event_date,
      custom_location: event.custom_location,
      requirements: event.requirements || [],
    }));

    res.json(response);
  } catch (err) {
    console.error("Error al descifrar o consultar:", err.message);
    res.status(400).json({ error: "ID inválido o error en la consulta" });
  }
});

router.get("/events/get-venue-info/:slugId", async (req, res) => {
  try {
    const slugId = req.params.slugId;

    const { data, error } = await supabase
      .from("venues")
      .select(
        "name, image, email, capacity, open_time, close_time, location, latitude, longitude"
      )
      .eq("slug", slugId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Venue no encontrado" });
    }

    res.json({
      name: data.name,
      capacity: data.capacity,
      email: data.email,
      image: data.image,
      open_time: data.open_time,
      close_time: data.close_time,
      long_location: data.location,
      latitude: data.latitude || 0,
      longitud: data.longitude || 0,
    });
  } catch (err) {
    console.error("Error al obtener venue info:", err.message);
    res.status(400).json({ error: "ID inválido o error en la consulta" });
  }
});

router.get("/events/get-venue-description/:slugId", async (req, res) => {
  try {
    const slugId = req.params.slugId;

    const { data, error } = await supabase
      .from("venues")
      .select("description")
      .eq("slug", slugId)
      .single();

    if (error) {
      console.error("Supabase error:", error.message);
      return res.status(500).json({ error: "Error en la consulta" });
    }

    if (!data || !data.description) {
      return res
        .status(404)
        .json({ error: "Venue no encontrado o sin descripción" });
    }

    res.json({ description: data.description });
  } catch (err) {
    console.error("Error al obtener descripción del venue:", err.message);
    res.status(400).json({ error: "ID inválido o error en la consulta" });
  }
});

router.get("/get-reservation-types/:encryptedVenueId", async (req, res) => {
  const { encryptedVenueId } = req.params;

  if (!encryptedVenueId) {
    return res.status(400).json({ error: "Falta el venueId cifrado." });
  }

  let venueId;
  try {
    venueId = decrypt(encryptedVenueId);
  } catch (err) {
    console.error("Error al descifrar venueId:", err);
    return res.status(400).json({ error: "venueId inválido o mal cifrado." });
  }

  try {
    const { data: venue, error } = await supabase
      .from("venues")
      .select("id, reservation_types, days")
      .eq("id", venueId)
      .maybeSingle();

    if (error) throw error;
    if (!venue) {
      return res.status(404).json({ error: "Venue no encontrado." });
    }

    res.status(200).json({
      venue_id: venue.id,
      reservation_types: venue.reservation_types || [],
      days: venue.days || {},
    });
  } catch (err) {
    console.error("Error obteniendo tipos de reserva:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

router.post("/request-reservation", async (req, res) => {
  const { user, reservation, guestNames } = req.body;

  if (!user || !reservation || !guestNames || !Array.isArray(guestNames)) {
    return res
      .status(400)
      .json({ error: "Datos incompletos o mal formateados." });
  }

  const requiredUserFields = ["name", "surname", "email", "dpi"];
  const missing = requiredUserFields.filter((field) => !user[field]);
  if (missing.length) {
    return res
      .status(400)
      .json({ error: `Faltan campos de usuario: ${missing.join(", ")}` });
  }

  let venue_id;

  try {
    const { data: venue } = await supabase
      .from("venues")
      .select("id")
      .eq("slug", reservation.venueId)
      .single();

    if (!venue) {
      return res.status(404).json({ error: "Venue no encontrado." });
    }

    venue_id = venue.id;
  } catch (err) {
    console.error("Error al obtener venue:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }

  try {
    const userId = await dpiUpsertAndGetId(supabase, {
      dpi: user.dpi,
      email: user.email,
      name: user.name,
      surname: user.surname,
      birth_date: user.birth_date || null,
    });

    const start_date = new Date(`${reservation.date}T${reservation.startTime}`);
    const end_date = new Date(`${reservation.date}T${reservation.endTime}`);

    const { data: reservationData, error: insertReservationError } =
      await supabase
        .from("reservations")
        .insert({
          creator_id: userId,
          venue_id,
          payment_term_id: reservation.paymentTerm,
          guests: reservation.guests,
          start_date,
          end_date,
          total_amount: 1000,
          reservation_type: reservation.table === true ? 1 : 2,
          created_at: new Date().toISOString(),
          status_id: 1,
        })
        .select("id")
        .single();

    if (insertReservationError) throw insertReservationError;

    const allGuests = [];

    allGuests.push({
      reservation_id: reservationData.id,
      status_id: 2,
      user_id: userId,
      temp_name: null,
      is_cancelled: false,
    });

    const temporaryGuests = guestNames.map((name) => ({
      reservation_id: reservationData.id,
      status_id: 2,
      user_id: null,
      temp_name: name,
      is_cancelled: false,
    }));

    allGuests.push(...temporaryGuests);

    const { error: guestsError } = await supabase
      .from("reservation_guests")
      .insert(allGuests);

    if (guestsError) throw guestsError;

    res.status(201).json({
      status: 201,
      message: "Reserva solicitada con éxito.",
      reservationId: reservationData.id,
    });
  } catch (err) {
    console.error("Error en reserva:", err);
    res
      .status(500)
      .json({ status: 500, error: err.message || JSON.stringify(err) });
  }
});

export default router;

//Para testear endpoints
//----------------------
// /get-reservation-types/:encryptedVenueId
//----------------------
