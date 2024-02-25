const axios = require("axios");
const express = require("express");
const querystring = require("querystring");
require('dotenv').config();

const app = express();
const port = 3000;

let storedSubdomain = null;

app.use(express.urlencoded({ extended: true })); // Middleware to parse form data

app.get("/", (req, res) => {
  res.send(`
    <form action="/zendesk/auth" method="get">
      <label for="subdomain">Zendesk Subdomain:</label>
      <input type="text" id="subdomain" name="subdomain" required>
      <button type="submit">Sign in to Zendesk</button>
    </form>
  `);
});

app.get("/zendesk/auth", (req, res) => {
  const subdomain = req.query.subdomain;

  if (!subdomain) {
    return res.send("Please provide a Zendesk subdomain.");
  }
 storedSubdomain = subdomain;
  res.redirect(
    `https://${subdomain}.zendesk.com/oauth/authorizations/new?${querystring.stringify(
      {
        response_type: "code",
        redirect_uri: process.env.REDIRECT_URI,
        client_id: process.env.ZENDESK_CLIENT_ID,
        scope: "users:read"
      }
    )}`
  );
});

app.get("/zendesk/oauth/callback", async (req, res) => {
  const subdomain = storedSubdomain;

  const tokenResponse = await axios.post(
    `https://${subdomain}.zendesk.com/oauth/tokens`,
    {
      grant_type: "authorization_code",
      code: "code",
      client_id: process.env.ZENDESK_CLIENT_ID,
      client_secret: process.env.ZENDESK_CLIENT_SECRET,
      redirect_uri: process.env.REDIRECT_URI,
      scope: "users:read"
    },
    { headers: { "Content-Type": "application/json" } }
  );

  // In production, you'd store the access token somewhere in your app,
  // such as a database.
  const access_token = await tokenResponse.data.access_token;

  const profileResponse = await axios.get(
    `https://${subdomain}.zendesk.com/api/v2/users/me.json`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );

  res.send(`
    <p>👋 Hi, ${profileResponse.data.user.name}!</p>
    
    <p>Your Zendesk Support user role is <code>${profileResponse.data.user.role}</code>.</p>
  `);
});

app.listen(port, () => {
  console.log(
    `Server running on port ${port}. Visit http://localhost:${port}`
  );
});
