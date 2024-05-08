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
app.use(express.json());
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
        scope: "users:read hc:read hc:write",
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
async function getHelpCenterArticles(pageNum, query = '') {
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
    let zendeskEndpoint = `https://${subdomain}.zendesk.com/api/v2/help_center/articles.json?per_page=10&page=${pageNum}`;

    // If a search query is provided, append it to the API endpoint
    if (query) {
      zendeskEndpoint += `&query=${encodeURIComponent(query)}`;
    }

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
    // Return only the required number of articles
    return { articles, prev, next };
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

async function searchHelpCenterArticles(query, pageNum) {
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

    // Build the Zendesk API search endpoint
    let zendeskSearchEndpoint = `https://${subdomain}.zendesk.com/api/v2/help_center/articles/search.json?per_page=10&page=${pageNum}&query=${encodeURIComponent(query)}`;

    // Make the API request with the retrieved access token
    const response = await axios.get(zendeskSearchEndpoint, {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
      params: {
        sort_by: "relevance", // Sort by relevance by default
        sort_order: "desc", // Sort in descending order by default
      },
    });

    const articles = response.data.results; // Extract articles from search results
    const count = response.data.count;
    const next = response.data.next_page;
    const prev = response.data.previous_page;

    // Return only the required number of articles
    return { articles, prev, next };
  } catch (error) {
    console.error(
      "Error fetching and processing help center articles:",
      error.message
    );
    return null; // Return null to indicate that an error occurred
  }
}

// Endpoint to search for articles
app.get("/zendesk/articles/search", async (req, res) => {
  try {
    const query = req.query.query || ''; // Get search query from query parameters
    const pageNum = parseInt(req.query.pageNum) || 1; // Get pageNum from query parameters, default to 1
    const { articles, prev, next } = await searchHelpCenterArticles(query, pageNum);
    res.json({ articles, prev, next });
  } catch (error) {
    console.error("Error searching articles:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Endpoint to fetch a single article by ID
app.get("/zendesk/articles/:article_id", async (req, res) => {
  try {
    const articleId = req.params.article_id; // Get article ID from URL parameter
    const subdomain = storedSubdomain;

    // Build the Zendesk API endpoint to fetch a single article by ID
    const zendeskArticleEndpoint = `https://${subdomain}.zendesk.com/api/v2/help_center/articles/${articleId}.json`;

    // Fetch the article using axios
    const response = await axios.get(zendeskArticleEndpoint, {
      headers: {
        Authorization: `Bearer ${storedAccessToken}`,
      },
    });

    const article = response.data.article;

    // Render the article-revise.ejs template and pass the fetched article data to it
    res.render("revise-article", { article });
  } catch (error) {
    console.error("Error fetching article:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.put("/zendesk/articles/:article_id/translations/:locale", async (req, res) => {
  try {
    const { article_id, locale } = req.params;
    const { updatedContent } = req.body;
    console.log("Received request body:", req.body);
    console.log("Received request params:", req.params);
    const subdomain = storedSubdomain;

    // Build the Zendesk API endpoint to update article translation
    const zendeskTranslationEndpoint = `https://${subdomain}.zendesk.com/api/v2/help_center/articles/${article_id}/translations/${locale}.json`;

    // Make the PUT request to update article translation using axios
    const response = await axios.put(zendeskTranslationEndpoint, {
      translation: {
        locale: locale,
        source_type: "Article",
        body: updatedContent // Use the variable containing the updated content
      }
    }, {
      headers: {
        Authorization: `Bearer ${storedAccessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 200) {
      res.status(200).json({ message: `Article translation for locale ${locale} updated successfully!` });
    } else {
      res.status(response.status).json({ error: response.statusText });
    }
  } catch (error) {
    console.error("Error updating article translation:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


//OPENAI calls
const openaiApiKey = process.env.OPENAI_API_KEY;

async function generateResponse(articleBody, userPrompt) {
    try {
        console.log("User Prompt:", userPrompt);
        console.log("Article Body:", articleBody);
        const systemPrompt = "Preserve original HTML structure; Make specified revisions to body text only; Output should be HTML format only. Make the requested changes: ";
        const fullPrompt = systemPrompt + userPrompt;
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: "user", content: articleBody },
                    { role: "system", content: fullPrompt }
                ],
                temperature: 0.3
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openaiApiKey}`
                }
            }
        );

        return response.data.choices[0].message.content;
      console.log(response.data.choices[0].message.content);
    } catch (error) {
        //console.error('Error generating response:', error);
        throw new Error('Error generating response');
    }
}


app.post('/submit-prompt', async (req, res) => {
    const { articleBody, userPrompt } = req.body;

    try {
        const aiResponse = await generateResponse(articleBody, userPrompt);
        res.json({ success: true, data: aiResponse });
    } catch (error) {
        //console.error('Error generating response:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});




app.listen(port, () => {
  console.log(`Server running on port ${port}. Visit http://localhost:${port}`);
});
