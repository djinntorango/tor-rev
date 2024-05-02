const axios = require("axios");
const express = require("express");
const querystring = require("querystring");
require("dotenv").config();
const { initializeDatabase, storeAccessToken, getAccessToken } = require('./src/sqlite.js');

const app = express();
const path = require('path');
const port = 3000;

const data = require("./src/data.json");
const db = require("./src/" + data.database);

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use('/public', (req, res, next) => {
  res.header('Content-Type', 'text/css');
  next();
}, express.static(path.join(__dirname, 'public')));

app.use(express.urlencoded({ extended: true })); // Middleware to parse form data

let storedSubdomain = null;
let storedAccessToken = null;

app.get("/", (req, res) => {
  res.render("index");
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
        scope: "users:read hc:read",
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
        scope: "users:read",
      },
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const access_token = tokenResponse.data.access_token;

    // Use the initializeDatabase function from sqlite.js
    const db = await initializeDatabase();

    // Store access token in the database
    await storeAccessToken(db, access_token);

    storedAccessToken = access_token;
    const profileResponse = await axios.get(
      `https://${subdomain}.zendesk.com/api/v2/users/me.json`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    // Call getHelpCenterArticles function to fetch articles
    const articles = await getHelpCenterArticles();
    

res.render("oauth-callback", { profileResponse });
  } catch (error) {
    console.error("Error in OAuth callback:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Function to retrieve a list of help center articles
async function getHelpCenterArticles() {
  const subdomain = storedSubdomain;

  try {
    // Use the initializeDatabase function from sqlite.js
    const db = await initializeDatabase();

    // Retrieve access token from the database
    const access_token = await getAccessToken(db);

    // Ensure there is a valid access token
    if (!access_token) {
      console.error("Access token not found in the database.");
      return null; // Return null to indicate that no articles were fetched
    }

    // Build the Zendesk API endpoint
    const zendeskEndpoint = `https://${subdomain}.zendesk.com/api/v2/help_center/articles.json`;

    let allArticles = []; // Array to store all articles

    let nextPage = zendeskEndpoint;

    // Loop until there are no more pages
    while (nextPage) {
      // Make the API request with the retrieved access token
      const response = await axios.get(nextPage, {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
        params: {
          sort_by: "updated_at",
          sort_order: "asc",
        },
      });

      const articles = response.data.articles;

      // Add fetched articles to the array
      allArticles = allArticles.concat(articles);

      // Get the next page URL
      nextPage = response.data.next_page;
    }

    return allArticles; // Return all fetched articles
  } catch (error) {
    console.error(
      "Error fetching and processing help center articles:",
      error.message
    );
    return null; // Return null to indicate that an error occurred
  }
}

app.get("/articles", async (req, res) => {
  const articles = await getHelpCenterArticles();
  if (articles) {
    res.render("articles", { articles });
  } else {
    res.status(500).send("Error fetching articles");
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}. Visit http://localhost:${port}`);
});
