import {
  redirectToAuthCodeFlow,
  getAccessToken,
} from "./getAccessRefreshToken";

const clientId = process.env.clientId;
const params = new URLSearchParams(window.location.search);
const code = params.get("code");

if (!code) {
  redirectToAuthCodeFlow(clientId);
} else {
  const accessToken = await getAccessToken(clientId, code);
  const profile = await fetchUserPlaylist(accessToken);
  populateUI(profile);
}

async function fetchUserPlaylist(accessToken) {
  const result = await fetch("https://api.spotify.com/v1/me/top/tracks", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return await result.json();
}
