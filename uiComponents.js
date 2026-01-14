// PhotoLynk Mobile App - Reusable UI Components
// Extracted from App.js for cleaner code organization

import React, { useRef, useEffect } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';

/**
 * Animated gradient spinner with pulsing effect
 * Used as loading indicator throughout the app
 */
export const GradientSpinner = ({ size = 80 }) => {
  const spinValue = useRef(new Animated.Value(0)).current;
  const pulseValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spinAnimation = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseValue, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    spinAnimation.start();
    pulseAnimation.start();

    return () => {
      spinAnimation.stop();
      pulseAnimation.stop();
    };
  }, [spinValue, pulseValue]);

  const rotate = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const scale = pulseValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1.1],
  });

  const colors = ['#03E1FF', '#00FFA3', '#02C4E0', '#00CC88'];
  const petalCount = 8;
  const petals = [];

  for (let i = 0; i < petalCount; i++) {
    const angle = (i * 360) / petalCount;
    const colorIndex = i % colors.length;
    petals.push(
      <View
        key={i}
        style={[
          spinnerStyles.petal,
          {
            backgroundColor: colors[colorIndex],
            width: size * 0.28,
            height: size * 0.38,
            borderRadius: size * 0.14,
            transform: [
              { rotate: `${angle}deg` },
              { translateY: -size * 0.22 },
            ],
            opacity: 0.6 + (i / petalCount) * 0.4,
          },
        ]}
      />
    );
  }

  return (
    <Animated.View
      style={[
        spinnerStyles.container,
        {
          width: size,
          height: size,
          transform: [{ rotate }, { scale }],
        },
      ]}
    >
      {petals}
      <View
        style={[
          spinnerStyles.center,
          {
            width: size * 0.3,
            height: size * 0.3,
            borderRadius: size * 0.15,
          },
        ]}
      />
    </Animated.View>
  );
};

const spinnerStyles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  petal: {
    position: 'absolute',
  },
  center: {
    backgroundColor: '#1E3A8A',
    position: 'absolute',
  },
});

/**
 * Glass card component with blur effect
 * Used for modal overlays and cards
 */
export const GlassCard = ({ children, style, glassEnabled, intensity = 80, tint = 'dark' }) => {
  if (!glassEnabled) {
    return (
      <View style={[glassStyles.fallbackCard, style]}>
        {children}
      </View>
    );
  }

  return (
    <BlurView intensity={intensity} tint={tint} style={[glassStyles.blurCard, style]}>
      {children}
    </BlurView>
  );
};

const glassStyles = StyleSheet.create({
  fallbackCard: {
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderRadius: 16,
    overflow: 'hidden',
  },
  blurCard: {
    borderRadius: 16,
    overflow: 'hidden',
  },
});
