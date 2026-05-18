import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";

const app = express();
app.use(cors({
  origin: "http://localhost:3000", // Your React app URL
  credentials: true
}));
//app.use(cors());
app.use(express.json());

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ message: "Stag.io Backend API is running" });
});

// استخدم الـ route
app.use("/api/auth", authRoutes);


// 404 handler for undefined routes
app.use("*", (req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
//app.listen(5000, () => console.log("Server running on port 5000"));