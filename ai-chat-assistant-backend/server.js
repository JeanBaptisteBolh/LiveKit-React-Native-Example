import { WebSocketServer } from "ws";
import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import { RoomServiceClient, AccessToken } from "livekit-server-sdk";
import { createClient } from "@deepgram/sdk";
import { PassThrough } from "stream";

dotenv.config();

const app = express();
app.use(cors());
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// LiveKit credentials
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = "wss://polychat-rvf1tgjt.livekit.cloud";

const liveKitClient = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);

// Deepgram used for speech-to-text and text-to-speech
const deepgram = new createClient(process.env.DEEPGRAM_API_KEY);

let rooms = {}; // Store rooms for management

// Create a LiveKit Room function
const createLiveKitRoom = async (roomName) => {
  try {
    const room = await liveKitClient.createRoom({ name: roomName });
    console.log(`Room ${roomName} created on LiveKit server.`);
    return room;
  } catch (error) {
    console.error(`Error creating room: ${error}`);
    return;
  }
};

const handleAudioTrack = (ws, track) => {
  console.log("Starting audio track processing for STT...");

  // This is a type of stream in Node.js that simply passes data through without transforming it.
  // It will be used to pipe audio data to Deepgram.
  const audioStream = new PassThrough();

  const deepgramLive = deepgram.transcription.live({
    punctuate: true,
    model: "general",
    language: "en-US", // TODO: Get the language from the client
  });

  // Event listener for when a transcription is received from Deepgram
  deepgramLive.addListener("transcriptReceived", (transcription) => {
    const transcript = transcription.channel.alternatives[0].transcript;
    console.log(`Transcription: ${transcript}`);

    // Send the transcription back to the client
    ws.send(
      JSON.stringify({
        type: "STT_RESULT",
        payload: { transcription: transcript },
      })
    );
  });

  // Pipe the audio stream to Deepgram
  audioStream.pipe(deepgramLive);

  track.on("data", (data) => {
    console.log("Received audio data...");
    audioStream.write(data);
  });

  track.on("end", () => {
    audioStream.end();
  });
};

const generateToken = async (roomName) => {
  console.log("Generating token for room:", roomName);
  const token = new AccessToken(API_KEY, API_SECRET, {
    identity: roomName,
  });
  token.addGrant({ roomJoin: true, room: roomName });
  const jwt = await token.toJwt();
  console.log("Generated JWT:", jwt);
  return jwt;
};

// Handle WebSocket connections
wss.on("connection", (ws) => {
  console.log("WebSocket connection established");

  ws.on("message", async (message) => {
    console.log("GOT MESSAGE");

    try {
      const { type, payload } = JSON.parse(message);
      console.log("Recieved message:", type, payload);

      switch (type) {
        case "CREATE_ROOM":
          const roomName = payload.roomName;
          // If the room does not exist, create it
          if (!rooms[roomName]) {
            const room = await createLiveKitRoom(roomName);
            rooms[roomName] = room;
          }
          const token = await generateToken(roomName);
          ws.send(
            JSON.stringify({
              type: "ROOM_CREATED",
              payload: { roomName, token },
            })
          );
          break;

        case "JOIN_ROOM":
          const { roomName: joinRoomName } = payload;
          console.log("ROOMS:", rooms);
          if (rooms[joinRoomName]) {
            console.log("Room found in JOIN_ROOM...");
            // Subscribe to the audio track
            const room = await liveKitClient.getRoom(joinRoomName);

            console.log("Here");
            room.on("trackSubscribed", (track, publication, participant) => {
              console.log("In here");
              if (track.kind === "audio") {
                handleAudioTrack(ws, track);
              }
            });

            ws.send(
              JSON.stringify({
                type: "JOINED_ROOM",
                payload: { roomName: joinRoomName },
              })
            );
          }
          break;

        case "LEAVE_ROOM":
          const { roomName: leaveRoomName } = payload;
          if (rooms[leaveRoomName]) {
            delete rooms[leaveRoomName]; // Remove room
            ws.send(
              JSON.stringify({
                type: "LEFT_ROOM",
                payload: { roomName: leaveRoomName },
              })
            );
          }
          break;

        // Additional message handling as needed
      }
    } catch (error) {
      console.error("Error handling message:", error);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed");
  });
});

server.listen(8080, () => {
  console.log("Server is running on http://localhost:8080");
});
