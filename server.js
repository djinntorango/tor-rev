const axios = require("axios")
const express = require("express")
const querystring = require("querystring")
require('dotenv').config();

const app = express()
const port = 3000

// In production, store your client id and secret in environment variables
const ZENDESK_CLIENT_ID = process.env.ZENDESK_CLIENT_ID;
const ZENDESK_CLIENT_SECRET = process.env.ZENDESK_CLIENT_SECRET;
const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN;
const REDIRECT_URI = process.env.REDIRECT_URI;

app.get("/", (req, res) => {
  res.send('<p><a href="/zendesk/auth">Sign in to Zendesk</a></p>')
})

app.get("/zendesk/auth", (req, res) => {
  res.redirect(
    `https://${ZENDESK_SUBDOMAIN}.zendesk.com/oauth/authorizations/new?${querystring.stringify(
      {
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        client_id: ZENDESK_CLIENT_ID,
        scope: "users:read"
      }
    )}`
  )
})

app.get("/zendesk/oauth/callback", async (req, res) => {
  const tokenResponse = await axios.post(
    `https://${ZENDESK_SUBDOMAIN}.zendesk.com/oauth/tokens`,
    {
      grant_type: "authorization_code",
      code: req.query.code,
      client_id: ZENDESK_CLIENT_ID,
      client_secret: ZENDESK_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      scope: "users:read"
    },
    { headers: { "Content-Type": "application/json" } }
  )

  // In production, you'd store the access token somewhere in your app,
  // such as a database.
  const access_token = await tokenResponse.data.access_token

  const profileResponse = await axios.get(
    `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/users/me.json`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  )

  res.send(`
    <p>👋 Hi, ${profileResponse.data.user.name}!</p>
    
    <p>Your Zendesk Support user role is <code>${profileResponse.data.user.role}</code>.</p>
`)
})

app.listen(port, () => {
  console.log(
    `Server running on port ${port}. Visit http://localhost:${port}`
  )
  })