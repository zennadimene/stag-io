import bcrypt from "bcryptjs";

async function generateHash() {
  const password = "admin123";  // ضع كلمة المرور التي تريدها
  const hashed = await bcrypt.hash(password, 10);
  console.log("Hashed password:", hashed);
}

generateHash();