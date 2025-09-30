import { v4 as uuidv4 } from "uuid";
import { supabase } from "../services/supabaseClient.js";
import { encrypt, decrypt } from "../services/cryptoService.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { dpiUpsertAndGetId } from "../utils/userUtils.js";
import fs from "fs";
import path from "path";
import fontkit from "@pdf-lib/fontkit";

const reserveTickets = async (req, res) => {
  const { slug_id, ticket_type_id, tickets } = req.body;

  if (
    !slug_id ||
    !ticket_type_id ||
    !Array.isArray(tickets) ||
    tickets.length === 0
  ) {
    return res
      .status(400)
      .json({ error: "Uncompleted data, please review it" });
  }

  let decryptedTicketTypeId;
  try {
    decryptedTicketTypeId = decrypt(ticket_type_id);
  } catch (err) {
    console.error("Invalid ticket_type_id:", err);
    return res
      .status(400)
      .json({ error: "Invalid ticket_type_id or malformed." });
  }

  for (const [index, t] of tickets.entries()) {
    const missingFields = [];

    if (!t.owner_name || typeof t.owner_name !== "string")
      missingFields.push("owner_name");
    if (!t.owner_last_name || typeof t.owner_last_name !== "string")
      missingFields.push("owner_last_name");
    if (!t.owner_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.owner_email))
      missingFields.push("owner_email");
    if (!t.owner_phone || !/^\d{6,15}$/.test(t.owner_phone))
      missingFields.push("owner_phone");
    if (!t.owner_dpi || !/^\d{6,20}$/.test(t.owner_dpi))
      missingFields.push("owner_dpi");

    const birthDate = new Date(t.owner_birthdate);
    if (
      !t.owner_birthdate ||
      isNaN(birthDate.getTime()) ||
      birthDate > new Date()
    ) {
      missingFields.push("owner_birthdate");
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `El ticket ${
          index + 1
        } tiene campos inválidos: ${missingFields.join(", ")}`,
      });
    }
  }

  try {
    const { data: venueData, error: venueError } = await supabase
      .from("events")
      .select("id")
      .eq("slug", slug_id)
      .single();

    if (venueError || !venueData) {
      throw new Error("Evento no encontrado para el slug proporcionado.");
    }

    const { data: ticketType, error: ticketError } = await supabase
      .from("ticket_types")
      .select("price, available_quantity")
      .eq("id", decryptedTicketTypeId)
      .eq("event_id", venueData.id)
      .maybeSingle();

    if (ticketError || !ticketType)
      throw new Error("Tipo de ticket no encontrado.");
    if (ticketType.available_quantity < tickets.length) {
      return res
        .status(400)
        .json({ error: "No hay suficientes tickets disponibles." });
    }

    const primary = tickets[0];
    const primaryUserId = await dpiUpsertAndGetId(supabase, {
      dpi: primary.owner_dpi,
      email: primary.owner_email,
      name: primary.owner_name,
      surname: primary.owner_last_name,
      birth_date: primary.owner_birthdate,
    });

    const total = ticketType.price * tickets.length;

    const { data: orderData, error: orderError } = await supabase
      .from("orders")
      .insert({
        event_id: venueData.id,
        ticket_type_id: decryptedTicketTypeId,
        user_id: primaryUserId,
        quantity: tickets.length,
        total,
        status: "paid",
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (orderError) throw orderError;

    const order_id = orderData.id;

    const ticketsToInsert = [];

    for (const t of tickets) {
      const ticketUserId = await dpiUpsertAndGetId(supabase, {
        dpi: t.owner_dpi,
        email: t.owner_email,
        name: t.owner_name,
        surname: t.owner_last_name,
        birth_date: t.owner_birthdate,
      });

      ticketsToInsert.push({
        order_id: order_id,
        event_id: venueData.id,
        ticket_type_id: decryptedTicketTypeId,
        holder_id: ticketUserId,
        qr_token: `${uuidv4()}-${Date.now()}`,
      });
    }

    const { error: ticketInsertError } = await supabase
      .from("tickets")
      .insert(ticketsToInsert);

    if (ticketInsertError) throw ticketInsertError;

    const { error: updateError } = await supabase
      .from("ticket_types")
      .update({
        available_quantity: ticketType.available_quantity - tickets.length,
      })
      .eq("id", decryptedTicketTypeId);

    if (updateError) throw updateError;

    res.status(201).json({
      message: "Reserva realizada con éxito",
      order_id: encrypt(order_id), // Usar el order_id obtenido
    });
  } catch (err) {
    console.error("Error reservando:", err);
    res.status(500).json({ error: err.message || JSON.stringify(err) });
  }
};

const getTicketInfo = async (req, res) => {
  const { encryptedOrderId, slugId } = req.params;

  let orderId;

  if (!encryptedOrderId || !slugId) {
    return res.status(400).json({ error: "Faltan parámetros necesarios." });
  }

  try {
    orderId = decrypt(encryptedOrderId);
  } catch (decryptionError) {
    console.error("Error al descifrar el ID de la orden:", decryptionError);
    return res.status(400).json({ error: "ID de orden inválido o corrupto." });
  }

  try {
    // Obtener el evento
    const { data: eventData, error: eventError } = await supabase
      .from("events")
      .select("id")
      .eq("slug", slugId)
      .single();

    if (eventError || !eventData) {
      console.error("Error obteniendo el evento:", eventError);
      return res.status(404).json({ error: "Evento no encontrado." });
    }

    // Consulta actualizada con las nuevas relaciones
    const { data: tickets, error: ticketError } = await supabase
      .from("tickets")
      .select(
        `
        qr_token,
        ticket_types(benefits),
        events(name, event_date, start_time),
        public_users:holder_id(name, surname, email)
      `
      )
      .eq("order_id", orderId)
      .eq("event_id", eventData.id);

    if (ticketError || !tickets || tickets.length === 0) {
      console.error("Error obteniendo tickets:", ticketError);
      return res
        .status(404)
        .json({ error: "No se encontraron tickets para esta orden." });
    }

    res.status(200).json({
      tickets: tickets.map((ticket) => ({
        owner_full_name: `${ticket.public_users.name} ${ticket.public_users.surname}`,
        owner_email: ticket.public_users.email,
        event_name: ticket.events.name,
        event_date: new Date(ticket.events.event_date).toLocaleDateString(
          "es-ES",
          {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          }
        ),
        qr_token: encrypt(ticket.qr_token),
        start_time: ticket.events.start_time,
        benefits: ticket.ticket_types
          ? ticket.ticket_types.benefits
          : "No hay beneficios disponibles",
      })),
    });
  } catch (err) {
    console.error("Error obteniendo información de tickets:", err);
    res
      .status(500)
      .json({ error: err.message || "Error interno del servidor." });
  }
};

const generateTicketsPDF = async (req, res) => {
  const { encryptedOrderId } = req.params;
  let orderId;

  try {
    orderId = decrypt(encryptedOrderId);
  } catch (err) {
    return res.status(400).json({ error: "ID de orden inválido o corrupto." });
  }

  try {
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        "*, events(name, event_date, start_time, venue_id), ticket_types(name)"
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order)
      throw orderError || new Error("Orden no encontrada.");

    const { data: tickets, error: ticketError } = await supabase
      .from("tickets")
      .select("*")
      .eq("order_id", orderId);

    if (ticketError || tickets.length === 0)
      throw ticketError || new Error("No se encontraron tickets.");

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    // Cargar fuentes
    const regularFontPath = path.join(
      __dirname,
      "../assets/fonts/NotoSans-Regular.ttf"
    );
    const boldFontPath = path.join(
      __dirname,
      "../assets/fonts/NotoSans-Bold.ttf"
    ); // Asegúrate de tener esta fuente

    let customFont, boldFont;

    try {
      const regularFontBytes = fs.readFileSync(regularFontPath);
      customFont = await pdfDoc.embedFont(regularFontBytes);
    } catch (fontError) {
      console.warn(
        "No se pudo cargar la fuente personalizada, usando fuente estándar"
      );
      customFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }

    try {
      const boldFontBytes = fs.readFileSync(boldFontPath);
      boldFont = await pdfDoc.embedFont(boldFontBytes);
    } catch (fontError) {
      console.warn("No se pudo cargar la fuente bold, usando fuente estándar");
      boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    }

    // Cargar logo (opcional)
    let logoImage = null;
    try {
      const logoPath = path.join(__dirname, "../assets/images/logo.png"); // Ajusta la ruta según tu estructura
      if (fs.existsSync(logoPath)) {
        const logoBytes = fs.readFileSync(logoPath);
        logoImage = await pdfDoc.embedPng(logoBytes);
      }
    } catch (logoError) {
      console.warn("No se pudo cargar el logo:", logoError.message);
    }

    for (const [index, ticket] of tickets.entries()) {
      const page = pdfDoc.addPage([420, 650]); // Tamaño ligeramente más grande
      const { width, height } = page.getSize();

      // === FONDO DEGRADADO NOCTURNO ===
      // Fondo principal oscuro
      page.drawRectangle({
        x: 0,
        y: 0,
        width: width,
        height: height,
        color: rgb(0.05, 0.05, 0.15), // Azul muy oscuro
      });

      // Efectos de gradiente simulado con rectángulos superpuestos
      page.drawRectangle({
        x: 0,
        y: height - 150,
        width: width,
        height: 150,
        color: rgb(0.15, 0.15, 0.15), // Gris oscuro en la parte superior
        opacity: 0.8,
      });

      page.drawRectangle({
        x: 0,
        y: 0,
        width: width,
        height: 100,
        color: rgb(0.1, 0.1, 0.1), // Gris más oscuro en la parte inferior
        opacity: 0.6,
      });

      // === HEADER CON LOGO Y TÍTULO ===
      const headerY = height - 80;

      // Logo (si está disponible)
      if (logoImage) {
        const logoSize = 40;
        page.drawImage(logoImage, {
          x: 30,
          y: headerY - logoSize / 2,
          width: logoSize,
          height: logoSize,
        });
      }

      // Título de la aplicación
      page.drawText("Pull", {
        x: logoImage ? 85 : 30,
        y: headerY + 5,
        size: 16,
        font: boldFont,
        color: rgb(1, 1, 1), // Blanco
      });

      page.drawText("Events management", {
        x: logoImage ? 85 : 30,
        y: headerY - 15,
        size: 10,
        font: customFont,
        color: rgb(0.7, 0.7, 0.7), // Gris claro
      });

      // === LÍNEA DECORATIVA ===
      page.drawRectangle({
        x: 30,
        y: headerY - 35,
        width: width - 60,
        height: 2,
        color: rgb(0.5, 0.5, 0.5), // Gris medio
      });

      // === INFORMACIÓN DEL EVENTO ===
      const eventY = height - 160;

      // Título del evento
      page.drawText(order.events.name.toUpperCase(), {
        x: 30,
        y: eventY,
        size: 18,
        font: boldFont,
        color: rgb(1, 1, 1),
      });

      // Fecha y hora
      const eventDate = new Date(order.events.event_date);
      const formattedDate = eventDate.toLocaleDateString("es-ES", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      page.drawText(`📅 ${formattedDate}`, {
        x: 30,
        y: eventY - 25,
        size: 12,
        font: customFont,
        color: rgb(0.9, 0.9, 0.9),
      });

      if (order.events.start_time) {
        page.drawText(`🕘 ${order.events.start_time}`, {
          x: 30,
          y: eventY - 45,
          size: 12,
          font: customFont,
          color: rgb(0.9, 0.9, 0.9),
        });
      }

      // Tipo de ticket
      page.drawText(`🎫 ${order.ticket_types?.name || "General"}`, {
        x: 30,
        y: eventY - 65,
        size: 12,
        font: customFont,
        color: rgb(0.9, 0.9, 0.9),
      });

      // === QR CODE ESTILIZADO ===
      const encryptedQrToken = encrypt(ticket.qr_token);
      const qrDataUrl = await QRCode.toDataURL(encryptedQrToken, {
        errorCorrectionLevel: "M",
        type: "image/png",
        quality: 0.92,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
        width: 140,
      });

      const qrImage = await pdfDoc.embedPng(qrDataUrl);
      const qrSize = 120;
      const qrX = (width - qrSize) / 2;
      const qrY = 280;

      // Fondo blanco para el QR
      page.drawRectangle({
        x: qrX - 10,
        y: qrY - 10,
        width: qrSize + 20,
        height: qrSize + 20,
        color: rgb(1, 1, 1),
      });

      // Borde decorativo para el QR
      page.drawRectangle({
        x: qrX - 12,
        y: qrY - 12,
        width: qrSize + 24,
        height: qrSize + 24,
        color: rgb(0.4, 0.4, 0.4), // Gris medio
      });

      page.drawImage(qrImage, {
        x: qrX,
        y: qrY,
        width: qrSize,
        height: qrSize,
      });

      // Texto bajo el QR
      page.drawText("ESCANEA PARA ACCEDER", {
        x: (width - 150) / 2,
        y: qrY - 30,
        size: 10,
        font: boldFont,
        color: rgb(0.8, 0.8, 0.8), // Gris claro
      });

      // === INFORMACIÓN DEL TITULAR ===
      const holderY = 220;

      // Sección de titular
      page.drawRectangle({
        x: 20,
        y: holderY - 80,
        width: width - 40,
        height: 70,
        color: rgb(0.1, 0.1, 0.2),
        opacity: 0.8,
      });

      page.drawText("TITULAR DEL TICKET", {
        x: 30,
        y: holderY - 20,
        size: 12,
        font: boldFont,
        color: rgb(0.8, 0.8, 0.8), // Gris claro
      });

      page.drawText(`${ticket.owner_name} ${ticket.owner_last_name}`, {
        x: 30,
        y: holderY - 40,
        size: 14,
        font: boldFont,
        color: rgb(1, 1, 1),
      });

      page.drawText(`DPI: ${ticket.owner_dpi}`, {
        x: 30,
        y: holderY - 60,
        size: 10,
        font: customFont,
        color: rgb(0.9, 0.9, 0.9),
      });

      page.drawText(`📧 ${ticket.owner_email}`, {
        x: 30,
        y: holderY - 75,
        size: 9,
        font: customFont,
        color: rgb(0.8, 0.8, 0.8),
      });

      // === TÉRMINOS Y CONDICIONES ===
      page.drawText("• Presenta tu DPI junto con este ticket", {
        x: 30,
        y: 90,
        size: 8,
        font: customFont,
        color: rgb(0.7, 0.7, 0.7),
      });

      page.drawText("• No transferible • Válido solo para la fecha indicada", {
        x: 30,
        y: 75,
        size: 8,
        font: customFont,
        color: rgb(0.7, 0.7, 0.7),
      });

      // === EFECTOS DECORATIVOS ===
      // Puntos decorativos en las esquinas
      const dotSize = 3;
      for (let i = 0; i < 5; i++) {
        page.drawCircle({
          x: 15 + i * 8,
          y: height - 15,
          size: dotSize,
          color: rgb(0.5, 0.5, 0.5), // Gris medio
          opacity: 0.6 - i * 0.1,
        });
      }

      // Líneas laterales decorativas
      page.drawRectangle({
        x: 5,
        y: 100,
        width: 3,
        height: height - 250,
        color: rgb(0.4, 0.4, 0.4), // Gris medio
        opacity: 0.4,
      });

      page.drawRectangle({
        x: width - 8,
        y: 100,
        width: 3,
        height: height - 250,
        color: rgb(0.4, 0.4, 0.4), // Gris medio
        opacity: 0.4,
      });
    }

    const pdfBytes = await pdfDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="nightlife-tickets.pdf"'
    );
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Error generando PDF:", err);
    res.status(500).json({ error: err.message || "Error generando PDF." });
  }
};

export { reserveTickets, getTicketInfo, generateTicketsPDF };

//Para testear endpoints
//----------------------
// /orders/reserve
//----------------------
//$body = @{
/*   slug_id = "evento-slug"
  ticket_type_id = "ticket-id-encriptado"
  tickets = @(
    @{
      owner_name = "Ana"
      owner_last_name = "García"
      owner_email = "ana@email.com"
      owner_phone = "50212345678"
      owner_dpi = "1234567890101"
      owner_birth_date = "1995-05-20"
    }
  )
} | ConvertTo-Json -Depth 5

Invoke-WebRequest `
  -Uri "http://192.168.20.197:3000/api/v1/orders/reserve" `
  -Method POST `
  -Body $body `
  -ContentType "application/json" `
  -Proxy "http://127.0.0.1:8080" `
  -UseBasicParsing */
//----------------------
