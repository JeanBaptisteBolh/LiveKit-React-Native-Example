import React, { useEffect, useState, useRef } from "react";
import { View, Text } from "react-native";
import { createLocalAudioTrack, Room } from "livekit-client";
import AudioLevelVisual from "@/components/AudioLevelVisual";
import { registerGlobals } from "@livekit/react-native";

registerGlobals();

interface ServerMessage {
  type: string;
  payload: any;
}

export default function HomeScreen() {
  const [room, setRoom] = useState<Room | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioWsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleServerMessage = async (message: ServerMessage) => {
    const { type, payload } = message;

    switch (type) {
      case "ROOM_CREATED":
        const room = new Room();
        console.log(`Connecting to created room: ${payload.roomName}`);
        try {
          await room.connect(
            String(process.env.EXPO_PUBLIC_LIVEKIT_URL),
            payload.token
          );
          console.log(`Connected!`);
          setRoom(room);

          room.on("disconnected", () => {
            setRoom(null);
          });

          console.log("Sending JOIN_ROOM message", wsRef.current);
          wsRef.current?.send(
            JSON.stringify({
              type: "JOIN_ROOM",
              payload: { roomName: payload.roomName },
            })
          );
          console.log("Sent JOIN_ROOM message");
        } catch (error) {
          console.error("Error connecting to room:", error);
        }

        break;

      case "JOINED_ROOM":
        console.log(`Joined room: ${payload.roomName}`);
        await captureAndPublishAudio(); // Start capturing and publishing audio
        break;

      case "LEFT_ROOM":
        console.log(`Left room: ${payload.roomName}`);
        break;

      case "STT_RESULT":
        console.log(`STT Result: ${payload.transcript}`);
        break;

      // Handle other messages as needed
    }
  };

  const captureAndPublishAudio = async () => {
    console.log("Trying to capture and publish audio");
    if (!room) return;

    console.log("PUBLISHING AUDIO");
    // Capture local audio track
    const audioTrack = await createLocalAudioTrack();

    // Publish the audio track to the room
    room.localParticipant.publishTrack(audioTrack);
    console.log("Audio track published");
  };

  const cleanupWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const attemptSocketReconnect = () => {
    console.log(`Reconnect attempt ${reconnectAttemptsRef.current + 1}`);

    // Clear any existing timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    const timeout = 5000; // 5 seconds between each reconnect attempt
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectAttemptsRef.current += 1;
      cleanupWebSocket();
      connectWebSocket();
    }, timeout);
  };

  // Connects to websocket server, creates livekit room, and sets up event listeners
  const connectWebSocket = () => {
    const websocket = new WebSocket(
      String(process.env.EXPO_PUBLIC_WEBSOCKET_ADDRESS)
    );
    wsRef.current = websocket;

    websocket.onopen = () => {
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
      websocket.send(
        JSON.stringify({
          type: "CREATE_ROOM",
          payload: { roomName: "test-room" },
        })
      );
    };

    websocket.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      handleServerMessage(message);
    };

    websocket.onclose = (event) => {
      console.log("WebSocket connection closed", event);
      setIsConnected(false);
      attemptSocketReconnect();
    };

    websocket.onerror = (error) => {
      console.error("WebSocket error:", error);
      setIsConnected(false);
      // We don't call attemptSocketReconnect() here, as onclose will be called after onerror
    };
  };

  // useEffect(() => {
  //   console.log("WS readystate Updated:", ws?.readyState);
  // }, [ws?.readyState]);

  // useEffect(() => {
  //   console.log("WS updated:", wsRef);
  // }, [ws]);

  useEffect(() => {
    connectWebSocket();

    return () => {
      // Cleanup function to leave the room when the component unmounts
      if (wsRef.current) {
        wsRef.current.send(
          JSON.stringify({
            type: "LEAVE_ROOM",
            payload: { roomName: "test-room" },
          })
        );
        wsRef.current.close();
      }
      // Clear any pending reconnection attempt
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        {isConnected ? <AudioLevelVisual /> : <Text>"Connecting..."</Text>}
      </View>
    </>
  );
}
