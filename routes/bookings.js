import express from "express";
const router = express.Router();
import { supabase } from "../services/supabaseClient.js";
import { encrypt, decrypt } from "../services/cryptoService.js";
import { hashDPI } from "../utils/userUtils.js";
import { generateToken } from "../services/jwtService.js";
import {
  authenticateReservationToken,
  validateBookingAccess,
} from "../middleware/bookingAuth.js";

router.get("/get-bookings/:venue_id", async (req, res) => {
  try {
    const { venue_id } = req.params;
    const { status, page = 1, limit = 10 } = req.query;

    if (!venue_id) {
      return res.status(400).json({
        error: "Venue ID is required",
      });
    }

    let realVenueId;
    try {
      realVenueId = decrypt(venue_id);
    } catch (decryptError) {
      return res.status(400).json({
        error: "Invalid venue ID format",
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Obtener el ID del estado si se proporciona filtro
    let statusId = null;
    if (status && status !== "All") {
      const { data: statusData, error: statusError } = await supabase
        .from("reservation_statuses")
        .select("id")
        .eq("name", status)
        .single();

      if (statusError || !statusData) {
        return res.status(400).json({
          error: "Invalid status filter",
        });
      }
      statusId = statusData.id;
    }

    // Query principal
    let query = supabase
      .from("reservations")
      .select(
        `
        id,
        guests,
        total_amount,
        start_date,
        end_date,
        created_at,
        reservation_types!reservations_reservation_type_fkey (
          name
        ),
        reservation_statuses!reservations_status_id_fkey (
          name
        ),
        public_users!reservations_creator_id_fkey (
          name,
          surname,
          email
        )
      `
      )
      .eq("venue_id", realVenueId)
      .gte("start_date", new Date().toISOString())
      .order("start_date", { ascending: true });

    if (statusId) {
      query = query.eq("status_id", statusId);
    }

    query = query.range(offset, offset + limitNum - 1);

    const { data: bookings, error } = await query;

    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({
        error: "Failed to fetch bookings",
        details: error.message,
      });
    }

    let countQuery = supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", realVenueId)
      .gte("start_date", new Date().toISOString());

    if (statusId) {
      countQuery = countQuery.eq("status_id", statusId);
    }

    const { count, error: countError } = await countQuery;

    if (countError) {
      console.error("Count error:", countError);
    }

    const totalCount = count || 0;

    const processedBookings = bookings.map((booking) => ({
      id: encrypt(booking.id),
      customerName: `${booking.public_users.name} ${booking.public_users.surname}`,
      email: booking.public_users.email,
      guests: booking.guests,
      totalAmount: booking.total_amount,
      status: booking.reservation_statuses.name,
      type: booking.reservation_types.name,
      date: booking.start_date.split("T")[0],
      startDateTime: booking.start_date,
      endDateTime: booking.end_date,
      createdAt: booking.created_at,
    }));

    const totalPages = Math.ceil(totalCount / limitNum);
    const hasMore = pageNum < totalPages;

    res.json({
      success: true,
      bookings: processedBookings,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        hasMore,
        limit: limitNum,
      },
    });
  } catch (err) {
    console.error("Server error:", err.message);
    console.error("Stack:", err.stack);
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

router.get("/get-booking-details/:booking_id", async (req, res) => {
  try {
    const { booking_id } = req.params;

    if (!booking_id) {
      return res.status(400).json({
        error: "Booking ID is required",
      });
    }

    let realBookingId;
    try {
      realBookingId = decrypt(booking_id);
    } catch (decryptError) {
      return res.status(400).json({
        error: "Invalid booking ID format",
      });
    }

    const { data: booking, error } = await supabase
      .from("reservations")
      .select(
        `
        id,
        guests,
        total_amount,
        start_date,
        end_date,
        created_at,
        reservation_types!reservations_reservation_type_fkey (
          name
        ),
        reservation_statuses!reservations_status_id_fkey (
          name
        ),
        public_users!reservations_creator_id_fkey (
          name,
          surname,
          email
        )
      `
      )
      .eq("id", realBookingId)
      .single();

    if (error || !booking) {
      return res.status(404).json({
        error: "Booking not found",
        details: error?.message,
      });
    }

    const processedBooking = {
      id: encrypt(booking.id),
      customerName: `${booking.public_users.name} ${booking.public_users.surname}`,
      email: booking.public_users.email,
      phone: booking.public_users.phone,
      guests: booking.guests,
      totalAmount: booking.total_amount,
      status: booking.reservation_statuses.name,
      type: booking.reservation_types.name,
      date: booking.start_date.split("T")[0],
      time: booking.start_date.split("T")[1]?.substring(0, 5),
      endTime: booking.end_date.split("T")[1]?.substring(0, 5),
      startDateTime: booking.start_date,
      endDateTime: booking.end_date,
      createdAt: booking.created_at,
    };

    // Si el estado es "modified", obtener solo los conteos
    let modifications = null;
    if (booking.reservation_statuses.name === "modified") {
      const { data: guestsData, error: guestsError } = await supabase
        .from("reservation_guests")
        .select("status_id")
        .eq("reservation_id", realBookingId)
        .in("status_id", [6, 7]); // 6=to_remove, 7=to_add

      if (!guestsError && guestsData) {
        const guestsToRemove = guestsData.filter(
          (guest) => guest.status_id === 6
        ).length;
        const guestsToAdd = guestsData.filter(
          (guest) => guest.status_id === 7
        ).length;

        modifications = {
          guestsToRemove,
          guestsToAdd,
          hasModifications: guestsToRemove > 0 || guestsToAdd > 0,
        };
      }
    }

    res.json({
      success: true,
      booking: processedBooking,
      modifications: modifications,
    });
  } catch (err) {
    console.error("Server error:", err.message);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.patch("/update-status/:booking_id", async (req, res) => {
  try {
    const { booking_id } = req.params;
    const { status, venue_id, organization_id, employee_id } = req.body;

    // Validaciones básicas
    if (!booking_id) {
      return res.status(400).json({
        error: "Booking ID is required",
      });
    }

    if (!status) {
      return res.status(400).json({
        error: "Status is required",
      });
    }

    if (!venue_id || !organization_id || !employee_id) {
      return res.status(400).json({
        error: "Venue ID, Organization ID and Employee ID are required",
      });
    }

    // Desencriptar el booking ID
    let realBookingId;
    try {
      realBookingId = decrypt(booking_id);
    } catch (decryptError) {
      return res.status(400).json({
        error: "Invalid booking ID format",
      });
    }

    // Desencriptar los otros IDs
    const realVenueId = decrypt(venue_id);
    const realOrgId = decrypt(organization_id);

    // Verificar que la reserva existe y pertenece al venue/organización correcta
    const { data: existingBooking, error: fetchError } = await supabase
      .from("reservations")
      .select(
        `
        id,
        venue_id,
        venues!reservations_venue_id_fkey (
          organization_id
        )
      `
      )
      .eq("id", realBookingId)
      .single();

    if (fetchError || !existingBooking) {
      return res.status(404).json({
        error: "Booking not found",
      });
    }

    // Verificar permisos: la reserva debe ser del venue/organización correcta
    if (
      existingBooking.venue_id !== realVenueId ||
      existingBooking.venues.organization_id !== realOrgId
    ) {
      return res.status(403).json({
        error:
          "Access denied. You don't have permission to modify this booking",
      });
    }

    // Obtener el ID del estado desde la tabla de estados
    const { data: statusData, error: statusError } = await supabase
      .from("reservation_statuses")
      .select("id")
      .eq("name", status)
      .single();

    if (statusError || !statusData) {
      return res.status(400).json({
        error:
          "Invalid status. Valid statuses are: pending, confirmed, cancelled",
      });
    }

    // Generar contraseña de 6 dígitos si el estado es 'confirmed'
    let managementPassword = null;
    if (status === "confirmed") {
      // Función para generar contraseña de 6 dígitos
      const generateSixDigitPassword = () => {
        return Math.floor(100000 + Math.random() * 900000).toString();
      };

      managementPassword = generateSixDigitPassword();
    }

    // Preparar datos de actualización
    const updateData = {
      status_id: statusData.id,
    };

    // Añadir contraseña si es confirmación
    if (managementPassword) {
      updateData.password = managementPassword;
    }

    // Actualizar la reserva
    const { error: updateError } = await supabase
      .from("reservations")
      .update(updateData)
      .eq("id", realBookingId);

    if (updateError) {
      console.error("Update error:", updateError);
      return res.status(500).json({
        error: "Failed to update booking status",
      });
    }

    // TODO: Implementar envío de email de confirmación
    // if (status === 'confirmed' && managementPassword) {
    //   try {
    //     await sendConfirmationEmail({
    //       bookingId: realBookingId,
    //       customerEmail: existingBooking.email,
    //       managementPassword: managementPassword,
    //       bookingDetails: existingBooking
    //     });
    //   } catch (emailError) {
    //     console.error("Email sending failed:", emailError);
    //     // No fallar el endpoint si el email falla
    //   }
    // }

    // Respuesta simple
    res.json({
      success: true,
      message: `Booking ${status} successfully`,
    });
  } catch (err) {
    console.error("Server error:", err.message);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.get("/:bookingId/details", async (req, res) => {
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

    const { data: booking, error: bookingError } = await supabase
      .from("reservations")
      .select(
        `
        id,
        guests,
        total_amount,
        start_date,
        end_date,
        created_at,
        venue_id,
        creator_id,
        reservation_types!reservations_reservation_type_fkey (
          name
        ),
        reservation_statuses!reservations_status_id_fkey (
          name
        ),
        public_users!reservations_creator_id_fkey (
          name,
          surname,
          email
        ),
        venues (
          name
        )
      `
      )
      .eq("id", realBookingId)
      .single();

    if (bookingError || !booking) {
      return res.status(404).json({
        error: "Booking not found",
        details: bookingError?.message,
      });
    }

    const { data: guests, error: guestsError } = await supabase
      .from("reservation_guests")
      .select(
        `
        guest_id,
        user_id,
        temp_name,
        paid_at,
        is_cancelled,
        guest_statuses!reservation_guests_status_id_fkey (
          name
        ),
        public_users (
          name,
          surname,
          email
        )
      `
      )
      .eq("reservation_id", realBookingId)
      .eq("is_cancelled", false)
      .neq("status_id", 5);

    if (guestsError) {
      console.error("Error fetching guests:", guestsError);
      return res.status(500).json({
        error: "Failed to fetch booking guests",
      });
    }

    const totalPaid = (guests || []).reduce((sum, guest) => {
      return guest.paid_at ? sum + booking.total_amount / booking.guests : sum;
    }, 0);

    const totalPending = booking.total_amount - totalPaid;
    const paymentProgress =
      booking.total_amount > 0 ? (totalPaid / booking.total_amount) * 100 : 0;

    const processedGuests = (guests || [])
      .sort((a, b) => {
        if (a.user_id === booking.creator_id) return -1;
        if (b.user_id === booking.creator_id) return 1;
        return 0;
      })
      .map((guest) => ({
        id: encrypt(guest.guest_id.toString()),
        name: guest.user_id
          ? `${guest.public_users?.name || ""} ${
              guest.public_users?.surname || ""
            }`.trim()
          : guest.temp_name || "Unknown Guest",
        email: guest.public_users?.email || null,
        paidAt: guest.paid_at,
        status: guest.guest_statuses?.name || "pending",
        isRegisteredUser: !!guest.user_id,
        isCreator: guest.user_id === booking.creator_id,
      }));

    res.json({
      success: true,
      booking: {
        id: encrypt(booking.id),
        venueId: encrypt(booking.venue_id),
        venueName: booking.venues?.name || "",
        venueAddress: booking.venues?.address || "",
        customerName: `${booking.public_users.name} ${booking.public_users.surname}`,
        email: booking.public_users.email,
        guests: booking.guests,
        totalAmount: booking.total_amount,
        status: booking.reservation_statuses.name,
        type: booking.reservation_types?.name || "",
        startDate: booking.start_date,
        endDate: booking.end_date,
        createdAt: booking.created_at,
        assistants: processedGuests,
        paymentSummary: {
          totalPaid: totalPaid,
          totalPending: totalPending,
          totalAmount: booking.total_amount,
          paymentProgress: Math.round(paymentProgress),
        },
      },
    });
  } catch (err) {
    console.error("Server error:", err.message);
    console.error("Stack:", err.stack);
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

router.post("/:bookingId/auth", async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { dpi, password } = req.body;

    if (!dpi || !password) {
      return res.status(400).json({
        error: "DPI and password are required",
      });
    }

    if (!/^\d{13}$/.test(dpi)) {
      return res.status(400).json({
        error: "DPI must be exactly 13 digits",
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

    const dpiHashed = hashDPI(dpi);

    const { data: booking, error: reservationError } = await supabase
      .from("reservations")
      .select(
        `
        id,
        password,
        creator_id,
        public_users!reservations_creator_id_fkey (
          dpi_hashed,
          name,
          surname,
          email
        )
      `
      )
      .eq("id", realBookingId)
      .single();

    if (reservationError || !booking) {
      return res.status(404).json({
        error: "booking not found",
      });
    }

    if (booking.public_users.dpi_hashed !== dpiHashed) {
      return res.status(401).json({
        error: "Invalid DPI for this booking",
      });
    }

    if (booking.password !== password) {
      return res.status(401).json({
        error: "Invalid password",
      });
    }

    const token = generateToken({
      bookingId: realBookingId,
      userId: booking.creator_id,
      role: "reservation_admin",
      dpiHash: dpiHashed,
    });

    res.json({
      success: true,
      message: "Authentication successful",
      token: token,
      user: {
        name: `${booking.public_users.name} ${booking.public_users.surname}`,
        email: booking.public_users.email,
      },
    });
  } catch (err) {
    console.error("Server error:", err.message);
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

router.put(
  "/:bookingId/modify-guests",
  authenticateReservationToken,
  validateBookingAccess,
  async (req, res) => {
    try {
      const { guestChanges } = req.body;
      const realBookingId = req.realBookingId;

      if (!guestChanges || !Array.isArray(guestChanges)) {
        return res.status(400).json({
          error: "Guest changes array is required",
        });
      }

      const { data: currentBooking, error: bookingError } = await supabase
        .from("reservations")
        .select("id, status_id, guests")
        .eq("id", realBookingId)
        .single();

      if (bookingError || !currentBooking) {
        return res.status(404).json({
          error: "Booking not found",
        });
      }

      if (currentBooking.status_id !== 2) {
        const statusMessages = {
          1: "pending approval",
          3: "cancelled",
          4: "rejected",
          5: "completed",
          6: "already has pending modifications",
        };

        return res.status(400).json({
          error: `Cannot modify booking. Current status: ${
            statusMessages[currentBooking.status_id] || "unknown"
          }`,
          currentStatus: currentBooking.status_id,
        });
      }

      const { data: statuses, error: statusError } = await supabase
        .from("guest_statuses")
        .select("id, name")
        .in("name", ["confirmed", "pending_add", "pending_remove"]);

      if (statusError || !statuses || statuses.length < 3) {
        return res.status(500).json({
          error: "Could not load guest status configuration",
        });
      }

      const statusMap = statuses.reduce((acc, status) => {
        acc[status.name] = status.id;
        return acc;
      }, {});

      const processChanges = async () => {
        const results = [];

        const deletions = guestChanges.filter(
          (change) => change.action === "delete"
        );
        if (deletions.length > 0) {
          const guestIds = deletions.map((change) => decrypt(change.guestId));

          const { error: deleteError } = await supabase
            .from("reservation_guests")
            .update({
              status_id: statusMap.pending_remove,
            })
            .in("guest_id", guestIds)
            .eq("reservation_id", realBookingId)
            .eq("is_cancelled", false);

          if (deleteError) throw deleteError;
          results.push(`${deletions.length} guests marked for removal`);
        }

        const additions = guestChanges.filter(
          (change) => change.action === "add"
        );
        if (additions.length > 0) {
          const newGuests = additions.map((change) => ({
            reservation_id: realBookingId,
            status_id: statusMap.pending_add,
            temp_name: change.guestName,
            user_id: null,
            is_cancelled: false,
          }));

          const { data: insertedGuests, error: addError } = await supabase
            .from("reservation_guests")
            .insert(newGuests)
            .select("guest_id");

          if (addError) throw addError;
          results.push(`${additions.length} guests added pending approval`);
        }

        const { error: updateError } = await supabase
          .from("reservations")
          .update({
            status_id: 6,
          })
          .eq("id", realBookingId);

        if (updateError) throw updateError;

        return results;
      };

      const changeResults = await processChanges();

      res.json({
        success: true,
        message: "Booking modification submitted successfully",
        data: {
          bookingStatus: "modified",
          note: "Changes are pending venue approval. You will be notified when they are reviewed.",
        },
      });
    } catch (err) {
      console.error("Server error:", err.message);
      res.status(500).json({
        error: "Internal server error",
        details: err.message,
      });
    }
  }
);

router.patch("/process-modifications/:booking_id", async (req, res) => {
  try {
    const { booking_id } = req.params;
    const { action, venue_id, organization_id, employee_id } = req.body;

    if (!booking_id || !action) {
      return res.status(400).json({
        error: "Booking ID and action are required",
      });
    }

    if (!venue_id || !organization_id || !employee_id) {
      return res.status(400).json({
        error: "Venue ID, Organization ID and Employee ID are required",
      });
    }

    let realBookingId;
    try {
      realBookingId = decrypt(booking_id);
    } catch (decryptError) {
      return res.status(400).json({
        error: "Invalid booking ID format",
      });
    }

    const realVenueId = decrypt(venue_id);
    const realOrgId = decrypt(organization_id);

    const { data: existingBooking, error: fetchError } = await supabase
      .from("reservations")
      .select(
        `
        id,
        guests,
        venue_id,
        venues!reservations_venue_id_fkey (
          organization_id
        )
      `
      )
      .eq("id", realBookingId)
      .single();

    if (fetchError || !existingBooking) {
      return res.status(404).json({
        error: "Booking not found",
      });
    }

    if (
      existingBooking.venue_id !== realVenueId ||
      existingBooking.venues.organization_id !== realOrgId
    ) {
      return res.status(403).json({
        error:
          "Access denied. You don't have permission to modify this booking",
      });
    }

    if (action === "accept") {
      await supabase
        .from("reservation_guests")
        .update({ status_id: 5 })
        .eq("reservation_id", realBookingId)
        .eq("status_id", 6);

      await supabase
        .from("reservation_guests")
        .update({ status_id: 2 })
        .eq("reservation_id", realBookingId)
        .eq("status_id", 7);
    } else if (action === "reject") {
      await supabase
        .from("reservation_guests")
        .update({ status_id: 2 })
        .eq("reservation_id", realBookingId)
        .eq("status_id", 6);

      await supabase
        .from("reservation_guests")
        .update({ status_id: 5 })
        .eq("reservation_id", realBookingId)
        .eq("status_id", 7);
    } else {
      return res.status(400).json({
        error: "Invalid action. Use 'accept' or 'reject'",
      });
    }

    const { data: confirmedGuests, error: guestsError } = await supabase
      .from("reservation_guests")
      .select("guest_id")
      .eq("reservation_id", realBookingId)
      .eq("status_id", 2);

    if (guestsError) {
      console.error("Error counting guests:", guestsError);
      return res.status(500).json({
        error: "Failed to update guest count",
      });
    }

    const totalGuests = confirmedGuests ? confirmedGuests.length : 0;

    const { data: confirmedStatus, error: statusError } = await supabase
      .from("reservation_statuses")
      .select("id")
      .eq("name", "confirmed")
      .single();

    if (statusError || !confirmedStatus) {
      return res.status(500).json({
        error: "Failed to get confirmed status",
      });
    }

    const { error: updateError } = await supabase
      .from("reservations")
      .update({
        status_id: confirmedStatus.id,
        guests: totalGuests,
      })
      .eq("id", realBookingId);

    if (updateError) {
      console.error("Error updating reservation:", updateError);
      return res.status(500).json({
        error: "Failed to update reservation",
      });
    }

    const actionText = action === "accept" ? "accepted" : "rejected";

    res.json({
      success: true,
      message: `Modifications ${actionText} successfully`,
      data: {
        updatedGuests: totalGuests,
        previousGuests: existingBooking.guests,
      },
    });
  } catch (err) {
    console.error("Server error:", err.message);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});

export default router;
