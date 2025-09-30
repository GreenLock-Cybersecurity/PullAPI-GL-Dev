import crypto from "crypto";

const APP_KEY = Buffer.from(process.env.APP_KEY, "hex");
const APP_IV = Buffer.from(process.env.APP_IV, "hex");
const ALGORITHM = "aes-256-cbc";

function encrypt(text) {
  const cipher = crypto.createCipheriv(ALGORITHM, APP_KEY, APP_IV);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}

function decrypt(encryptedText) {
  const decipher = crypto.createDecipheriv(ALGORITHM, APP_KEY, APP_IV);
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export { encrypt, decrypt };
