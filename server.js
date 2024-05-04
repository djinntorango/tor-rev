const axios = require("axios");
const express = require("express");
const querystring = require("querystring");
require("dotenv").config();
const {
  initializeDatabase,
  storeAccessToken,
  getAccessToken,
} = require("./src/sqlite.js");

const app = express();
const path = require("path");
const port = 3000;

const data = require("./src/data.json");
const db = require("./src/" + data.database);

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(
  "/public",
  (req, res, next) => {
    res.header("Content-Type", "text/css");
    next();
  },
  express.static(path.join(__dirname, "public"))
);

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

    // Check if pageNum parameter exists in query
    const pageNum = req.query.pageNum ? parseInt(req.query.pageNum) : 1;

    // Call your function to fetch articles based on the page number
    const { articles, prev, next } = await getHelpCenterArticles(subdomain, pageNum);

    let zendeskEndpoint = null;

    res.render("oauth-callback", {
      profileResponse,
      articles,
      zendeskEndpoint,
      prev, 
      next
    });
  } catch (error) {
    console.error("Error in OAuth callback:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Function to retrieve a list of help center articles
async function getHelpCenterArticles(pageNum) {
  const subdomain = storedSubdomain;
  try {
    // Use the initializeDatabase function from sqlite.js and retrieve token
    const db = await initializeDatabase();
    const access_token = await getAccessToken(db);

    // Ensure there is a valid access token
    if (!access_token) {
      console.error("Access token not found in the database.");
      return null; // Return null to indicate that no articles were fetched
    }

    // Build the Zendesk API endpoint
    const zendeskEndpoint = `https://${subdomain}.zendesk.com/api/v2/help_center/articles.json?per_page=10&page=${pageNum}`;
    let allArticles = []; // Array to store all articles
    let fetchedArticlesCount = 0;

    // Make the API request with the retrieved access token
    const response = await axios.get(zendeskEndpoint, {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
      params: {
        sort_by: "updated_at",
        sort_order: "asc",
      },
    });

    const articles = response.data.articles;
    const count = response.data.count;
    const next = response.data.next_page;
    const prev = response.data.previous_page;
    console.log(next);
    // Add fetched articles to the array & update count
    allArticles = allArticles.concat(articles);
    fetchedArticlesCount += articles.length;

    // Return only the required number of articles
    return { articles: allArticles, prev, next };
  } catch (error) {
    console.error(
      "Error fetching and processing help center articles:",
      error.message
    );
    return null; // Return null to indicate that an error occurred
  }
}

app.get("/zendesk/articles", async (req, res) => {
    try {
        const pageNum = parseInt(req.query.pageNum) || 1; // Get pageNum from query parameters, default to 1
    const { articles, prev, next } = await getHelpCenterArticles(pageNum);
    res.json({ articles, prev, next });
    } catch (error) {
        console.error("Error fetching articles:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


app.listen(port, () => {
  console.log(`Server running on port ${port}. Visit http://localhost:${port}`);
});
