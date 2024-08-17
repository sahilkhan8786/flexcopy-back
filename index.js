import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import orderRoute from './Routes/orders.js'
import path from "path";

const app = express();
dotenv.config();

app.use(express.json());
app.use(cors());

// Routes
app.use("/api/orders/", orderRoute);


const __dirname = path.resolve();

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "/client/build")));

  app.get("*", (req, res) =>
    res.sendFile(path.resolve(__dirname, "client", "build", "index.html"))
  );
} else {
  app.get("/", (req, res) => {
    res.send("API is running....");
  });
}

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Running on 5000");
});
