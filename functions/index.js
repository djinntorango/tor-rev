/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

const functions = require('firebase-functions');
const axios = require("axios");
const express = require("express");
const querystring = require("querystring");
const path = require("path");
const {
  initializeDatabase,
  storeAccessToken,
  getAccessToken,
} = require("./src/sqlite");

const app = express();
require("dotenv").config();

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

app.use(express.urlencoded({ extended: true }));
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
  storedSubdomain = subdomain;
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
      querystring.stringify({
        grant_type: "authorization_code",
        code: req.query.code,
        client_id: process.env.ZENDESK_CLIENT_ID,
        client_secret: process.env.ZENDESK_CLIENT_SECRET,
        redirect_uri: process.env.REDIRECT_URI,
        scope: "users:read",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const access_token = tokenResponse.data.access_token;

    const db = await initializeDatabase();
    await storeAccessToken(db, access_token);

    storedAccessToken = access_token;
    const profileResponse = await axios.get(
      `https://${subdomain}.zendesk.com/api/v2/users/me.json`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    const pageNum = req.query.pageNum ? parseInt(req.query.pageNum) : 1;
    const { articles, prev, next } = await getHelpCenterArticles(subdomain, pageNum);

    res.render("oauth-callback", {
      profileResponse,
      articles,
      prev, 
      next
    });
  } catch (error) {
    console.error("Error in OAuth callback:", error);
    res.status(500).send("Internal Server Error");
  }
});

async function getHelpCenterArticles(subdomain, pageNum, query = '') {
  try {
    const db = await initializeDatabase();
    const access_token = await getAccessToken(db);

    if (!access_token) {
      console.error("Access token not found in the database.");
      return null;
    }

    let zendeskEndpoint = `https://${subdomain}.zendesk.com/api/v2/help_center/articles.json?per_page=10&page=${pageNum}`;

    if (query) {
      zendeskEndpoint += `&query=${encodeURIComponent(query)}`;
    }

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
    const next = response.data.next_page;
    const prev = response.data.previous_page;
    return { articles, prev, next };
  } catch (error) {
    console.error("Error fetching and processing help center articles:", error.message);
    return null;
  }
}

app.get("/zendesk/articles", async (req, res) => {
  try {
    const pageNum = parseInt(req.query.pageNum) || 1;
    const { articles, prev, next } = await getHelpCenterArticles(storedSubdomain, pageNum);
    res.json({ articles, prev, next });
  } catch (error) {
    console.error("Error fetching articles:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

async function searchHelpCenterArticles(query, pageNum) {
  const subdomain = storedSubdomain;
  try {
    const db = await initializeDatabase();
    const access_token = await getAccessToken(db);

    if (!access_token) {
      console.error("Access token not found in the database.");
      return null;
    }

    let zendeskSearchEndpoint = `https://${subdomain}.zendesk.com/api/v2/help_center/articles/search.json?per_page=10&page=${pageNum}&query=${encodeURIComponent(query)}`;

    const response = await axios.get(zendeskSearchEndpoint, {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
      params: {
        sort_by: "relevance",
        sort_order: "desc",
      },
    });

    const articles = response.data.results;
    const next = response.data.next_page;
    const prev = response.data.previous_page;
    return { articles, prev, next };
  } catch (error) {
    console.error("Error fetching and processing help center articles:", error.message);
    return null;
  }
}

app.get("/zendesk/articles/search", async (req, res) => {
  try {
    const query = req.query.query || '';
    const pageNum = parseInt(req.query.pageNum) || 1;
    const { articles, prev, next } = await searchHelpCenterArticles(query, pageNum);
    res.json({ articles, prev, next });
  } catch (error) {
    console.error("Error searching articles:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/zendesk/articles/:article_id", async (req, res) => {
  try {
    const articleId = req.params.article_id;
    const subdomain = storedSubdomain;

    const zendeskArticleEndpoint = `https://${subdomain}.zendesk.com/api/v2/help_center/articles/${articleId}.json`;

    const response = await axios.get(zendeskArticleEndpoint, {
      headers: {
        Authorization: `Bearer ${storedAccessToken}`,
      },
    });

    const article = response.data.article;
    res.render("revise-article", { article });
  } catch (error) {
    console.error("Error fetching article:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.put("/zendesk/articles/:article_id/translations/:locale/title/:title", async (req, res) => {
  try {
    const { article_id, locale, title } = req.params;
    const { updatedContent } = req.body;
    const subdomain = storedSubdomain;

    const zendeskTranslationEndpoint = `https://${subdomain}.zendesk.com/api/v2/help_center/articles/${article_id}/translations/${locale}.json`;

    const response = await axios.put(zendeskTranslationEndpoint, {
      translation: {
        locale: locale,
        source_type: "Article",
        title: title,
        body: updatedContent
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

app.post("/zendesk/articles/:article_id/translations/:locale/title/:title", async (req, res) => {
  try {
    const { article_id, locale, title } = req.params;
    const { updatedContent } = req.body;
    const subdomain = storedSubdomain;

    const zendeskTranslationEndpoint = `https://${subdomain}.zendesk.com/api/v2/help_center/articles/${article_id}/translations.json`;

    const response = await axios.post(zendeskTranslationEndpoint, {
      translation: {
        locale: locale,
        source_type: "Article",
        title: title,
        body: updatedContent 
      }
    }, {
      headers: {
        Authorization: `Bearer ${storedAccessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 201) {
      res.status(201).json({ message: `Article translation for locale ${locale} updated successfully!` });
    } else {
      res.status(response.status).json({ error: response.statusText });
    }
  } catch (error) {
    console.error("Error updating article translation:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const openaiApiKey = process.env.OPENAI_API_KEY;

async function generateResponse(articleBody, userPrompt) {
  try {
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
  } catch (error) {
    throw new Error('Error generating response');
  }
}

app.post('/submit-prompt', async (req, res) => {
  const { articleBody, userPrompt } = req.body;

  try {
    const aiResponse = await generateResponse(articleBody, userPrompt);
    res.json({ success: true, data: aiResponse });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/translate-title', async (req, res) => {
  const { title, language } = req.body;

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: "user", content: title },
          { role: "system", content: `Translate this title to ${language}:` }
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

    res.json({ response: response.data.choices[0].message.content });
  } catch (error) {
    console.error('Error translating title:', error);
    res.status(500).json({ error: 'Failed to translate title' });
  }
});

exports.api = functions.https.onRequest(app);
