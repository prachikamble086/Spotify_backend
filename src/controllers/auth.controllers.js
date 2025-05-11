const express = require("express");
const router = express.Router();
const querystring = require("querystring");
const request = require("request");
const crypto = require("crypto");
const axios = require("axios");

let cachedAccessToken = null;

const client_id = process.env.client_id;
const client_secret = process.env.client_secret;

const redirect_uri = process.env.redirect_uri;

const generateRandomString = (length) => {
  return crypto.randomBytes(60).toString("hex").slice(0, length);
};

const stateKey = "spotify_auth_state";

router.get("/login", function (req, res) {
  console.log("Login route");
  const state = generateRandomString(16);
  // res.cookie(stateKey, state);
  res.cookie(stateKey, state, {
    httpOnly: true,
    domain: "127.0.0.1",
    path: "/",
  });
  console.log("state:", state, stateKey);

  const scope =
    "user-read-private user-read-email playlist-read-private playlist-read-collaborative user-library-read user-top-read user-read-playback-state user-modify-playback-state user-follow-read";
  res.redirect(
    "https://accounts.spotify.com/authorize?" +
      querystring.stringify({
        response_type: "code",
        client_id: client_id,
        scope: scope,
        redirect_uri: redirect_uri,
        state: state,
      })
  );
});

router.get("/", (req, res) => {
  res.send("Welcome to the Spotify OAuth App");
});

router.get("/callback", function (req, res) {
  const code = req.query.code || null;
  const state = req.query.state || null;

  const storedState = req.cookies ? req.cookies[stateKey] : null;

  if (state === null || state !== storedState) {
    console.log("State mismatch:", state, storedState);
    return res.status(400).json({
      error: "state_mismatch",
      message: "State verification failed",
    });
  }

  res.clearCookie(stateKey);

  const authOptions = {
    url: "https://accounts.spotify.com/api/token",
    form: {
      code: code,
      redirect_uri: redirect_uri,
      grant_type: "authorization_code",
      client_id: client_id,
      client_secret: client_secret,
    },
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(client_id + ":" + client_secret).toString("base64"),
    },
    json: true,
  };

  request.post(authOptions, function (error, response, body) {
    if (!error && response.statusCode === 200) {
      const access_token = body.access_token;
      const refresh_token = body.refresh_token;

      cachedAccessToken = access_token;

      console.log("access_token:", access_token);
      console.log("refresh_token:", refresh_token);

      const options = {
        url: "https://api.spotify.com/v1/me",
        headers: { Authorization: "Bearer " + access_token },
        json: true,
      };

      request.get(options, function (error, response, body) {
        if (error || response.statusCode !== 200) {
          return res.status(500).json({
            error: "Failed to fetch user profile from Spotify",
            details: body,
          });
        }

        res.json({
          success: true,
          message: "User authenticated successfully",
          profile: body,
        });
      });
    } else {
      res.status(500).json({
        error: "Failed to authenticate with Spotify",
        details: body,
      });
    }
  });
});

router.get("/refresh_token", function (req, res) {
  const refresh_token = req.query.refresh_token;
  const authOptions = {
    url: "https://accounts.spotify.com/api/token",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(client_id + ":" + client_secret).toString("base64"),
    },
    form: {
      grant_type: "refresh_token",
      refresh_token: refresh_token,
    },
    json: true,
  };

  request.post(authOptions, function (error, response, body) {
    if (!error && response.statusCode === 200) {
      const access_token = body.access_token,
        refresh_token = body.refresh_token;
      res.send({
        access_token: access_token,
        refresh_token: refresh_token,
      });
    }
  });
});

router.get("/playlists", function (req, res) {
  const access_token = req.query.access_token || cachedAccessToken;

  if (!access_token) {
    return res.status(400).json({ error: "Missing access_token" });
  }

  const options = {
    url: "https://api.spotify.com/v1/me/playlists",
    headers: {
      Authorization: "Bearer " + access_token,
    },
    json: true,
  };

  request.get(options, function (error, response, body) {
    if (!error && response.statusCode === 200) {
      res.json(body);
    } else {
      console.error("Failed to fetch playlists:", error || body);
      res.status(response.statusCode).json({
        error: "Failed to fetch playlists",
        details: body,
      });
    }
  });
});

router.get("/top_tracks", function (req, res) {
  const access_token = cachedAccessToken;

  if (!access_token) {
    return res.status(401).json({
      error: "No token provided",
      message: "You must log in to fetch top tracks.",
    });
  }

  axios
    .get("https://api.spotify.com/v1/me/top/tracks?limit=10", {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    .then((response) => {
      res.json({
        success: true,
        top_tracks: response.data.items,
      });
    })
    .catch((error) => {
      console.error(error);
      res.status(500).json({
        error: "Failed to fetch top tracks",
        details: error.response ? error.response.data : error.message,
      });
    });
});

router.get("/currently_playing", function (req, res) {
  const access_token = cachedAccessToken;

  if (!access_token) {
    return res.status(401).json({
      error: "No token provided",
      message: "You must log in to fetch currently playing track.",
    });
  }

  axios
    .get("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    })
    .then((response) => {
      if (response.status === 204 || !response.data) {
        return res.json({
          success: true,
          message: "No track is currently playing",
        });
      }

      res.json({
        success: true,
        currently_playing: response.data.item,
      });
    })
    .catch((error) => {
      console.error(
        "Error fetching currently playing track:",
        error.response?.data || error.message
      );
      res.status(500).json({
        error: "Failed to fetch currently playing track",
        details: error.response ? error.response.data : error.message,
      });
    });
});

router.get("/followed_artists", async (req, res) => {
  const access_token = cachedAccessToken;

  if (!access_token) {
    return res.status(401).json({
      error: "No token provided",
      message: "You must log in to fetch followed artists.",
    });
  }

  try {
    const response = await axios.get(
      "https://api.spotify.com/v1/me/following?type=artist&limit=20",
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    const artists = response.data.artists.items.map((artist) => ({
      name: artist.name,
      genres: artist.genres,
      followers: artist.followers.total,
    }));

    res.json({
      success: true,
      followed_artists: artists,
    });
  } catch (error) {
    console.error("Error fetching followed artists:", error.message);
    res.status(500).json({
      error: "Failed to fetch followed artists",
      details: error.response ? error.response.data : error.message,
    });
  }
});

router.get("/pause", async (req, res) => {
  const access_token = cachedAccessToken;

  if (!access_token) {
    return res.status(401).json({
      error: "No token provided",
      message: "You must log in to pause playback.",
    });
  }

  try {
    await axios.put(
      "https://api.spotify.com/v1/me/player/pause",
      {},
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    res.json({
      success: true,
      message: "Playback paused successfully.",
    });
  } catch (error) {
    console.error("Error pausing playback:", error.message);
    res.status(500).json({
      error: "Spotify Premium required",
      message: "Playback control features need a Spotify Premium account.",
    });
  }
});

router.put("/play", async (req, res) => {
  const access_token = cachedAccessToken;
  const { track_uri } = req.body;

  if (!access_token) {
    return res.status(401).json({
      error: "No token provided",
      message: "You must log in to start playback.",
    });
  }

  if (!track_uri) {
    return res.status(400).json({
      error: "Missing track_uri",
      message: "You must provide a Spotify track URI in the request body.",
    });
  }

  try {
    await axios.put(
      "https://api.spotify.com/v1/me/player/play",
      {
        uris: [track_uri],
      },
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    res.json({
      success: true,
      message: `Playback started for track: ${track_uri}`,
    });
  } catch (error) {
    console.error("Error starting playback:", error.message);
    res.status(500).json({
      error: "Spotify Premium required",
      message: "Playback control features need a Spotify Premium account.",
    });
  }
});

module.exports = router;
