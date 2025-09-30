import { encrypt } from "../services/cryptoService.js";
import crypto from "crypto";

function hashDPI(dpi) {
  const SALT = process.env.DPI_SALT;
  return crypto
    .createHash("sha256")
    .update(dpi + SALT)
    .digest("hex");
}

async function dpiUpsertAndGetId(
  supabase,
  { dpi, email, name, surname, birth_date }
) {
  const dpi_hashed = hashDPI(dpi);
  const dpi_encrypted = encrypt(dpi);

  const { data: existing, error: findErr } = await supabase
    .from("public_users")
    .select("id, email")
    .eq("dpi_hashed", dpi_hashed)
    .maybeSingle();

  if (findErr) {
    throw new Error(`Error buscando usuario por DPI: ${findErr.message}`);
  }

  if (existing) {
    if (email && existing.email !== email) {
      const { error: updErr } = await supabase
        .from("public_users")
        .update({ email })
        .eq("id", existing.id);
      if (updErr)
        throw new Error(`Error actualizando email: ${updErr.message}`);
    }
    return existing.id;
  }

  const { data: created, error: insErr } = await supabase
    .from("public_users")
    .insert({
      email,
      name,
      surname,
      birth_date,
      dpi: dpi_encrypted,
      dpi_hashed: dpi_hashed,
    })
    .select("id")
    .single();

  if (insErr) {
    throw new Error(`Error creando usuario: ${insErr.message}`);
  }

  return created.id;
}

export { dpiUpsertAndGetId, hashDPI };
