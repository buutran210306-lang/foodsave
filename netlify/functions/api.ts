import express from "express";
import serverless from "serverless-http";
import { app as foodSaveApp } from "../../src/app";

const app = express();

app.use("/.netlify/functions/api", foodSaveApp);
app.use(foodSaveApp);

export const handler = serverless(app);
