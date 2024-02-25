const axios = require("axios");
const express = require("express");
const querystring = require("querystring");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = 3000;

let storedSubdomain = null;
let storedAccessToken = null;
const zendeskEndpoint = 'https://${subdomain}.zendesk.com/api/v2/help_center/en-us/articles.json';

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
  storedSubdomain = subdomain; // Update with user-inputed subdomain
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
  try {
    const subdomain = storedSubdomain;

    const tokenResponse = await axios.post(
      `https://${subdomain}.zendesk.com/oauth/tokens`,
      {
        grant_type: "authorization_code",
        code: req.query.code,
        client_id: process.env.ZENDESK_CLIENT_ID,
        client_secret: process.env.ZENDESK_CLIENT_SECRET,
        redirect_uri: process.env.REDIRECT_URI,
        scope: "users:read"
      },
      { headers: { "Content-Type": "application/json" } }
    );

    // In production, you'd store the access token somewhere in your app,
    // such as a database.
    const access_token = tokenResponse.data.access_token;
    storedAccessToken=access_token;
    const profileResponse = await axios.get(
      `https://${subdomain}.zendesk.com/api/v2/users/me.json`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    res.send(`
      <p>👋 Hi, ${profileResponse.data.user.name}!</p>
      
      <p>Your Zendesk Support user role is <code>${profileResponse.data.user.role}</code>.</p>
    `);
  } catch (error) {
    console.error("Error in OAuth callback:", error);
    res.status(500).send("Internal Server Error");
  }
});


const csvWriter = createCsvWriter({
  path: 'help_center_articles.csv',
  header: [
    { id: 'id', title: 'ID' },
    { id: 'title', title: 'Title' },
    { id: 'body', title: 'Body' },
    { id: 'comments_disabled', title: 'Comments Disabled' },
    { id: 'created_at', title: 'Created At' },
    { id: 'edited_at', title: 'Edited At' },
    { id: 'html_url', title: 'HTML URL' },
    { id: 'label_names', title: 'Label Names' },
    { id: 'locale', title: 'Locale' },
    { id: 'outdated', title: 'Outdated' },
    { id: 'outdated_locales', title: 'Outdated Locales' },
    { id: 'permission_group_id', title: 'Permission Group ID' },
    { id: 'position', title: 'Position' },
    { id: 'promoted', title: 'Promoted' },
    { id: 'section_id', title: 'Section ID' },
    { id: 'source_locale', title: 'Source Locale' },
    { id: 'updated_at', title: 'Updated At' },
    { id: 'url', title: 'URL' },
    { id: 'user_segment_id', title: 'User Segment ID' },
    { id: 'vote_count', title: 'Vote Count' },
    { id: 'vote_sum', title: 'Vote Sum' },
  ],
});


// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'outlook',
  auth: {
    user: 'djinn@torango.io',
    pass: 'dhwknmmjtpwqyfyw',
  },
});

// Function to retrieve a list of help center articles
async function getHelpCenterArticles() {
  let nextPage = zendeskEndpoint;
  

  try {
    // Loop until there are no more pages
    while (nextPage) {
      // Make the API request
      const response = await axios.get(nextPage, {
        auth: storedAccessToken,
        params: {
          sort_by: 'updated_at',
          sort_order: 'asc',
        },
      });

      // Extract relevant information from the response
      const articles = response.data.articles;

      // Write articles to CSV file
      await csvWriter.writeRecords(articles);

      // Get the next page URL
      nextPage = response.data.next_page;
    }

    // Send email with CSV file attachment
    await sendEmail();
  } catch (error) {
    console.error('Error fetching and processing help center articles:', error.message);
  }
}



app.listen(port, () => {
  console.log(
    `Server running on port ${port}. Visit http://localhost:${port}`
  );
});
