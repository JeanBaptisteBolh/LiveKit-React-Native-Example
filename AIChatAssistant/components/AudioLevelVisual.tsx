import { useState, useEffect, useRef } from "react";
import { View, StyleSheet, Text, Animated } from "react-native";
import { Audio } from "expo-av";
import { Recording } from "expo-av/build/Audio";

export default function AudioLevelVisual() {
  const [recording, setRecording] = useState<Recording | undefined>();
  const [permissionResponse, requestPermission] = Audio.usePermissions();
  const [meteringValue, setMeteringValue] = useState<number | null | undefined>(
    null
  );
  const meteringInterval = useRef<NodeJS.Timeout | null>(null);
  const animatedValue = useRef(new Animated.Value(0)).current;

  async function startRecording() {
    try {
      if (permissionResponse?.status !== "granted") {
        console.log("Requesting permission..");
        await requestPermission();
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      if (recording) {
        await recording.stopAndUnloadAsync();
        setRecording(undefined);
      }

      console.log("Starting recording..");
      const { recording: newRecording } = await Audio.Recording.createAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      setRecording(newRecording);
      console.log("Recording started");

      meteringInterval.current = setInterval(async () => {
        if (newRecording) {
          const status = await newRecording.getStatusAsync();
          if (status.isRecording) {
            const normalizedValue = normalizeMeteringValue(status.metering);
            setMeteringValue(normalizedValue);
            Animated.timing(animatedValue, {
              toValue: normalizedValue,
              duration: 250,
              useNativeDriver: false,
            }).start();
          }
        }
      }, 250); // Update metering value every 250ms
    } catch (err) {
      console.error("Failed to start recording", err);
    }
  }

  async function stopRecording() {
    console.log("Stopping recording..");
    setRecording(undefined);
    if (meteringInterval.current) {
      clearInterval(meteringInterval.current);
      meteringInterval.current = null;
    }
    await recording?.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
    });
    const uri = recording?.getURI();
    console.log("Recording stopped and stored at", uri);
  }

  function normalizeMeteringValue(value: number | null | undefined): number {
    if (value === null || value === undefined) {
      return 0;
    }
    // Assuming the metering value range is from -160 dB to 0 dB
    const minDb = -160;
    const maxDb = -0;
    return (value - minDb) / (maxDb - minDb);
  }

  useEffect(() => {
    startRecording();

    return () => {
      stopRecording();
    };
  }, []);

  const circleSize = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 200], // Adjust these values as needed
  });

  return (
    <>
      <Animated.View
        style={[styles.circle, { width: circleSize, height: circleSize }]}
      />
      <Text style={styles.meteringText}>
        Metering Value:{" "}
        {meteringValue !== null ? meteringValue?.toFixed(2) : "N/A"}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  circle: {
    backgroundColor: "#3498db",
    borderRadius: 100,
  },
  meteringText: {
    fontSize: 20,
    textAlign: "center",
    marginTop: 20,
  },
});
