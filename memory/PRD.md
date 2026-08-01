# CoFoundr - Product Requirements Document

## Vision
CoFoundr is the Tinder for business cofounders and partners. Find the right person to build a business with, not just discuss ideas.

## Positioning
"Meet the person you'll build your next company with."

## Problem Statement
Millions want to start businesses but are blocked because they lack the right cofounder (developer, designer, marketer, salesperson) who shares their vision. Existing platforms (LinkedIn, Reddit, Discord, X, Facebook) are slow, unqualified, and lack real compatibility assessment.

## Solution
An AI-powered mobile app that finds the ideal business partner using professional, entrepreneurial, and human criteria. Swipe to discover, but the real value is the AI compatibility engine.

## Core Features Implemented (MVP)

### 1. Dual Authentication
- Email/Password with JWT
- Google Social Login (OAuth + PKCE, ID token verified server-side)
- Secure session management

### 2. Comprehensive Onboarding
- Personal info (name, country, city, languages, age)
- Profession selection (10 options)
- Skills (freeform tags)
- Experience level (7 levels including "sold company", "raised funds")
- Availability (6 options from full-time to weekends)
- Budget indication
- Objectives (SaaS, mobile app, agency, etc.)
- Work style preferences
- Values (bootstrap, raise funds, family, growth, etc.)
- Up to 5 profile photos (base64)

### 3. AI-Powered Matching (Claude Sonnet)
- Multi-dimensional compatibility scoring:
  - Skills complementarity
  - Vision alignment
  - Availability match
  - Personality compatibility
  - Objectives alignment
  - Work style match
- Overall compatibility percentage
- AI-generated explanation of why they match

### 4. Discovery & Swipe Interface
- Tinder-style card swiping with gestures
- Profile cards showing photos, key info, AI compatibility
- Left swipe to pass, right swipe to like
- Match detection when both swipe right

### 5. Matches & Chat
- List of all matches with compatibility scores
- Real-time chat via Socket.io
- Message history storage in MongoDB

### 6. Deal Rooms
- Collaboration spaces for matched pairs
- Project name and vision
- AI-generated 90-day roadmap
- Tasks, documents, decisions tracking

### 7. Projects/Job Postings
- Users can post cofounder opportunities
- Specify hours/week, equity, required skills
- Browse open opportunities

### 8. AI Business Ideas
- Generate tailored business ideas for matched pairs
- Based on combined skills and shared objectives

## Technical Stack

### Frontend
- **Framework**: Expo (React Native) + expo-router
- **State**: React Context + @tanstack/react-query
- **Animations**: react-native-reanimated + PanResponder for swipe
- **Auth**: expo-secure-store + expo-web-browser + expo-linking
- **Images**: expo-image-picker (base64 storage)

### Backend
- **API**: FastAPI (Python) with async/await
- **Database**: MongoDB with Motor (async driver)
- **Real-time**: Socket.io (python-socketio)
- **Auth**: JWT (python-jose) + bcrypt + Google OAuth
- **AI**: Claude (Opus 5 by default) via the official Anthropic SDK

### Deployment
- Backend port: 8001 (proxied via /api)
- Frontend port: 3000

## Business Model
- **Free**: 10 swipes/day, 5 matches, limited chat
- **Premium (~€20/mo)**: Unlimited swipes, advanced AI matching, deal rooms, AI assistant, daily recommendations
- **Enterprise**: For incubators, accelerators, universities

## Product Roadmap
1. ✅ Cofounder matching (MVP - CURRENT)
2. Freelancer & early employee search
3. Mentor connections
4. Business angel & investor introductions
5. AI-assisted automatic startup creation (Business Builder)

## Future Enhancements
- Video calls integration
- Document sharing in chat
- Verification badges (LinkedIn, GitHub, portfolio, identity)
- Gamification (levels, badges, achievements)
- Premium AI features (profile optimization, risk detection)
- Business Model Canvas generator
- Pitch deck & landing page creation
- Push notifications for matches
