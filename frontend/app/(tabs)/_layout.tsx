/**
 * Premium Tab Layout with Blur
 */
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Compass, Heart, Briefcase, Sparkles, User } from 'lucide-react-native';
import { theme } from '@/src/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brand,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarStyle: {
          position: 'absolute',
          borderTopWidth: 0,
          backgroundColor: Platform.OS === 'web' ? 'rgba(9,9,11,0.9)' : 'transparent',
          elevation: 0,
          height: 84,
          paddingTop: 10,
          paddingBottom: 24,
          borderTopColor: 'rgba(255,255,255,0.06)',
        },
        tabBarBackground: () => (
          <View style={StyleSheet.absoluteFill}>
            <BlurView
              intensity={80}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: 'rgba(9,9,11,0.7)',
                  borderTopWidth: 1,
                  borderTopColor: 'rgba(255,255,255,0.06)',
                },
              ]}
            />
          </View>
        ),
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
          letterSpacing: 0.2,
        },
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, focused }) => (
            <Compass size={22} color={color} strokeWidth={focused ? 2 : 1.75} />
          ),
        }}
      />
      <Tabs.Screen
        name="matches"
        options={{
          title: 'Matches',
          tabBarIcon: ({ color, focused }) => (
            <Heart size={22} color={color} strokeWidth={focused ? 2 : 1.75} fill={focused ? color : 'transparent'} />
          ),
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: 'AI Copilot',
          tabBarIcon: ({ color, focused }) => (
            <Sparkles size={22} color={color} strokeWidth={focused ? 2 : 1.75} />
          ),
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projects',
          tabBarIcon: ({ color, focused }) => (
            <Briefcase size={22} color={color} strokeWidth={focused ? 2 : 1.75} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <User size={22} color={color} strokeWidth={focused ? 2 : 1.75} />
          ),
        }}
      />
    </Tabs>
  );
}
