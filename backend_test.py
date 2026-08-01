"""
Comprehensive Backend API Tests for CoFoundr
Tests all backend endpoints with real API calls
"""
import os
import requests
import json
from typing import Dict, Any, Optional

# The backend to exercise, e.g. http://localhost:8001 or your deployed URL.
BACKEND_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"

# Test credentials
TEST_USER_1 = {
    "email": "test@cofound.com",
    "password": "test123",
    "name": "Test User"
}

TEST_USER_2 = {
    "email": "designer@test.com",
    "password": "test123",
    "name": "Designer User"
}

# Global state for test data
test_state = {
    "user1_token": None,
    "user1_id": None,
    "user2_token": None,
    "user2_id": None,
    "match_id": None,
    "project_id": None,
    "deal_room_id": None
}


def print_test(name: str):
    """Print test name"""
    print(f"\n{'='*60}")
    print(f"TEST: {name}")
    print('='*60)


def print_result(success: bool, message: str, data: Any = None):
    """Print test result"""
    status = "✅ PASS" if success else "❌ FAIL"
    print(f"{status}: {message}")
    if data:
        print(f"Data: {json.dumps(data, indent=2, default=str)}")


def make_request(
    method: str,
    endpoint: str,
    token: Optional[str] = None,
    json_data: Optional[Dict] = None,
    params: Optional[Dict] = None
) -> tuple[bool, Any]:
    """Make HTTP request and return (success, response_data)"""
    url = f"{BACKEND_URL}{endpoint}"
    headers = {}
    
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    try:
        if method == "GET":
            response = requests.get(url, headers=headers, params=params, timeout=30)
        elif method == "POST":
            response = requests.post(url, headers=headers, json=json_data, timeout=30)
        elif method == "PUT":
            response = requests.put(url, headers=headers, json=json_data, timeout=30)
        elif method == "DELETE":
            response = requests.delete(url, headers=headers, timeout=30)
        else:
            return False, f"Unsupported method: {method}"
        
        # Check if response is successful
        if response.status_code >= 200 and response.status_code < 300:
            try:
                return True, response.json()
            except:
                return True, response.text
        else:
            return False, {
                "status_code": response.status_code,
                "error": response.text
            }
    
    except Exception as e:
        return False, str(e)


def test_health_check():
    """Test 1: Health Check"""
    print_test("Health Check")
    
    success, data = make_request("GET", "/health")
    
    if success and data.get("status") == "healthy":
        print_result(True, "Health check passed", data)
        return True
    else:
        print_result(False, "Health check failed", data)
        return False


def test_user_registration():
    """Test 2: User Registration"""
    print_test("User Registration")
    
    success, data = make_request("POST", "/auth/register", json_data=TEST_USER_1)
    
    if success and "access_token" in data:
        test_state["user1_token"] = data["access_token"]
        test_state["user1_id"] = data["user_id"]
        print_result(True, "User 1 registered successfully", {
            "user_id": data["user_id"],
            "onboarding_completed": data.get("onboarding_completed")
        })
        return True
    else:
        # User might already exist, try login
        print_result(False, "Registration failed (user might exist)", data)
        return False


def test_user_login():
    """Test 3: User Login"""
    print_test("User Login")
    
    success, data = make_request("POST", "/auth/login", json_data={
        "email": TEST_USER_1["email"],
        "password": TEST_USER_1["password"]
    })
    
    if success and "access_token" in data:
        test_state["user1_token"] = data["access_token"]
        test_state["user1_id"] = data["user_id"]
        print_result(True, "User 1 logged in successfully", {
            "user_id": data["user_id"],
            "onboarding_completed": data.get("onboarding_completed")
        })
        return True
    else:
        print_result(False, "Login failed", data)
        return False


def test_get_current_user():
    """Test 4: Get Current User"""
    print_test("Get Current User (/auth/me)")
    
    if not test_state["user1_token"]:
        print_result(False, "No token available")
        return False
    
    success, data = make_request("GET", "/auth/me", token=test_state["user1_token"])
    
    if success and "user_id" in data:
        print_result(True, "Retrieved current user", {
            "user_id": data["user_id"],
            "email": data.get("email"),
            "onboarding_completed": data.get("onboarding_completed")
        })
        return True
    else:
        print_result(False, "Failed to get current user", data)
        return False


def test_complete_onboarding():
    """Test 5: Complete Onboarding"""
    print_test("Complete Onboarding")
    
    if not test_state["user1_token"]:
        print_result(False, "No token available")
        return False
    
    onboarding_data = {
        "country": "United States",
        "city": "San Francisco",
        "languages": ["English"],
        "age": 30,
        "profession": "developer",
        "skills": ["React", "Node.js", "Python"],
        "experience": "senior",
        "availability": "full_time",
        "budget": "bootstrap",
        "objectives": ["Build a SaaS", "Create startup"],
        "work_style": ["remote", "fast_paced"],
        "values": ["bootstrap", "fast_growth"],
        "bio": "Experienced developer looking for a cofounder"
    }
    
    success, data = make_request(
        "POST",
        "/onboarding/complete",
        token=test_state["user1_token"],
        json_data=onboarding_data
    )
    
    if success and data.get("onboarding_completed"):
        print_result(True, "Onboarding completed for User 1", data)
        return True
    else:
        print_result(False, "Onboarding failed", data)
        return False


def test_create_second_user():
    """Test 6: Create Second User (Designer)"""
    print_test("Create Second User (Designer)")
    
    # Try registration first
    success, data = make_request("POST", "/auth/register", json_data=TEST_USER_2)
    
    if success and "access_token" in data:
        test_state["user2_token"] = data["access_token"]
        test_state["user2_id"] = data["user_id"]
        print_result(True, "User 2 registered successfully", {
            "user_id": data["user_id"]
        })
        return True
    else:
        # Try login if registration fails
        success, data = make_request("POST", "/auth/login", json_data={
            "email": TEST_USER_2["email"],
            "password": TEST_USER_2["password"]
        })
        
        if success and "access_token" in data:
            test_state["user2_token"] = data["access_token"]
            test_state["user2_id"] = data["user_id"]
            print_result(True, "User 2 logged in successfully", {
                "user_id": data["user_id"]
            })
            return True
        else:
            print_result(False, "Failed to create/login User 2", data)
            return False


def test_complete_second_user_onboarding():
    """Test 7: Complete Second User Onboarding"""
    print_test("Complete Second User Onboarding")
    
    if not test_state["user2_token"]:
        print_result(False, "No token available for User 2")
        return False
    
    onboarding_data = {
        "country": "United States",
        "city": "San Francisco",
        "languages": ["English"],
        "age": 28,
        "profession": "designer",
        "skills": ["Figma", "UI/UX", "Branding"],
        "experience": "senior",
        "availability": "full_time",
        "budget": "bootstrap",
        "objectives": ["Build a SaaS", "Create startup"],
        "work_style": ["remote", "fast_paced"],
        "values": ["bootstrap", "fast_growth"],
        "bio": "Creative designer seeking technical cofounder"
    }
    
    success, data = make_request(
        "POST",
        "/onboarding/complete",
        token=test_state["user2_token"],
        json_data=onboarding_data
    )
    
    if success and data.get("onboarding_completed"):
        print_result(True, "Onboarding completed for User 2", data)
        return True
    else:
        print_result(False, "Onboarding failed for User 2", data)
        return False


def test_discovery_cards():
    """Test 8: Discovery Cards"""
    print_test("Discovery Cards")
    
    if not test_state["user1_token"]:
        print_result(False, "No token available for User 1")
        return False
    
    success, data = make_request("GET", "/discovery/cards", token=test_state["user1_token"])
    
    if success and "cards" in data:
        cards = data["cards"]
        print_result(True, f"Retrieved {len(cards)} discovery cards", {
            "count": len(cards),
            "has_user2": any(c["user"]["user_id"] == test_state["user2_id"] for c in cards) if test_state["user2_id"] else False
        })
        return True
    else:
        print_result(False, "Failed to get discovery cards", data)
        return False


def test_swipe_user1_on_user2():
    """Test 9: User 1 Swipes Right on User 2"""
    print_test("User 1 Swipes Right on User 2")
    
    if not test_state["user1_token"] or not test_state["user2_id"]:
        print_result(False, "Missing token or user2_id")
        return False
    
    swipe_data = {
        "target_user_id": test_state["user2_id"],
        "direction": "right"
    }
    
    success, data = make_request(
        "POST",
        "/swipe",
        token=test_state["user1_token"],
        json_data=swipe_data
    )
    
    if success:
        matched = data.get("matched", False)
        print_result(True, f"Swipe recorded (matched: {matched})", data)
        if matched:
            test_state["match_id"] = data.get("match_id")
        return True
    else:
        print_result(False, "Swipe failed", data)
        return False


def test_swipe_user2_on_user1():
    """Test 10: User 2 Swipes Right on User 1 (Create Match)"""
    print_test("User 2 Swipes Right on User 1")
    
    if not test_state["user2_token"] or not test_state["user1_id"]:
        print_result(False, "Missing token or user1_id")
        return False
    
    swipe_data = {
        "target_user_id": test_state["user1_id"],
        "direction": "right"
    }
    
    success, data = make_request(
        "POST",
        "/swipe",
        token=test_state["user2_token"],
        json_data=swipe_data
    )
    
    if success:
        matched = data.get("matched", False)
        if matched:
            test_state["match_id"] = data.get("match_id")
            print_result(True, "Match created!", {
                "match_id": test_state["match_id"],
                "compatibility": data.get("compatibility")
            })
        else:
            print_result(True, "Swipe recorded (no match yet)", data)
        return True
    else:
        print_result(False, "Swipe failed", data)
        return False


def test_get_matches_user1():
    """Test 11: Get Matches for User 1"""
    print_test("Get Matches for User 1")
    
    if not test_state["user1_token"]:
        print_result(False, "No token available for User 1")
        return False
    
    success, data = make_request("GET", "/matches", token=test_state["user1_token"])
    
    if success and "matches" in data:
        matches = data["matches"]
        print_result(True, f"Retrieved {len(matches)} matches for User 1", {
            "count": len(matches),
            "matches": [{"match_id": m.get("match_id"), "user": m.get("user", {}).get("profile", {}).get("name")} for m in matches]
        })
        
        # Store match_id if we don't have it yet
        if not test_state["match_id"] and len(matches) > 0:
            test_state["match_id"] = matches[0]["match_id"]
        
        return True
    else:
        print_result(False, "Failed to get matches", data)
        return False


def test_get_matches_user2():
    """Test 12: Get Matches for User 2"""
    print_test("Get Matches for User 2")
    
    if not test_state["user2_token"]:
        print_result(False, "No token available for User 2")
        return False
    
    success, data = make_request("GET", "/matches", token=test_state["user2_token"])
    
    if success and "matches" in data:
        matches = data["matches"]
        print_result(True, f"Retrieved {len(matches)} matches for User 2", {
            "count": len(matches)
        })
        return True
    else:
        print_result(False, "Failed to get matches", data)
        return False


def test_get_chat_messages():
    """Test 13: Get Chat Messages"""
    print_test("Get Chat Messages")
    
    if not test_state["user1_token"] or not test_state["match_id"]:
        print_result(False, "Missing token or match_id")
        return False
    
    success, data = make_request(
        "GET",
        f"/chat/{test_state['match_id']}/messages",
        token=test_state["user1_token"]
    )
    
    if success and "messages" in data:
        messages = data["messages"]
        print_result(True, f"Retrieved {len(messages)} messages", {
            "count": len(messages)
        })
        return True
    else:
        print_result(False, "Failed to get messages", data)
        return False


def test_send_chat_message():
    """Test 14: Send Chat Message"""
    print_test("Send Chat Message")
    
    if not test_state["user1_token"] or not test_state["match_id"]:
        print_result(False, "Missing token or match_id")
        return False
    
    message_data = {
        "match_id": test_state["match_id"],
        "content": "Hey! Excited to work together on a startup!",
        "type": "text"
    }
    
    success, data = make_request(
        "POST",
        f"/chat/{test_state['match_id']}/send",
        token=test_state["user1_token"],
        json_data=message_data
    )
    
    if success and "message_id" in data:
        print_result(True, "Message sent successfully", {
            "message_id": data["message_id"],
            "content": data.get("content")
        })
        return True
    else:
        print_result(False, "Failed to send message", data)
        return False


def test_create_project():
    """Test 15: Create Project"""
    print_test("Create Project")
    
    if not test_state["user1_token"]:
        print_result(False, "No token available for User 1")
        return False
    
    project_data = {
        "title": "SaaS Platform for Entrepreneurs",
        "description": "Building a platform to help entrepreneurs find cofounders and resources",
        "looking_for": "designer",
        "hours_per_week": 20,
        "equity_percentage": 25.0,
        "skills_needed": ["UI/UX", "Branding", "Product Design"]
    }
    
    success, data = make_request(
        "POST",
        "/projects/create",
        token=test_state["user1_token"],
        json_data=project_data
    )
    
    if success and "project_id" in data:
        test_state["project_id"] = data["project_id"]
        print_result(True, "Project created successfully", {
            "project_id": data["project_id"],
            "title": data.get("title")
        })
        return True
    else:
        print_result(False, "Failed to create project", data)
        return False


def test_get_projects():
    """Test 16: Get Projects"""
    print_test("Get Projects")
    
    if not test_state["user1_token"]:
        print_result(False, "No token available for User 1")
        return False
    
    success, data = make_request("GET", "/projects", token=test_state["user1_token"])
    
    if success and "projects" in data:
        projects = data["projects"]
        print_result(True, f"Retrieved {len(projects)} projects", {
            "count": len(projects)
        })
        return True
    else:
        print_result(False, "Failed to get projects", data)
        return False


def test_create_deal_room():
    """Test 17: Create Deal Room"""
    print_test("Create Deal Room")
    
    if not test_state["user1_token"] or not test_state["match_id"]:
        print_result(False, "Missing token or match_id")
        return False
    
    deal_room_data = {
        "match_id": test_state["match_id"],
        "project_name": "CoBuilder Platform",
        "vision": "Create the best platform for entrepreneurs to find cofounders and build successful startups together"
    }
    
    success, data = make_request(
        "POST",
        "/deal-rooms/create",
        token=test_state["user1_token"],
        json_data=deal_room_data
    )
    
    if success and "room_id" in data:
        test_state["deal_room_id"] = data["room_id"]
        print_result(True, "Deal room created successfully", {
            "room_id": data["room_id"],
            "project_name": data.get("project_name")
        })
        return True
    else:
        print_result(False, "Failed to create deal room", data)
        return False


def test_generate_roadmap():
    """Test 18: Generate AI Roadmap"""
    print_test("Generate AI Roadmap")
    
    if not test_state["user1_token"] or not test_state["deal_room_id"]:
        print_result(False, "Missing token or deal_room_id")
        return False
    
    success, data = make_request(
        "POST",
        f"/deal-rooms/{test_state['deal_room_id']}/generate-roadmap",
        token=test_state["user1_token"]
    )
    
    if success and "phases" in data:
        print_result(True, "Roadmap generated successfully", {
            "phases_count": len(data.get("phases", [])),
            "key_metrics": data.get("key_metrics", [])
        })
        return True
    else:
        print_result(False, "Failed to generate roadmap", data)
        return False


def test_get_business_ideas():
    """Test 19: Get AI Business Ideas"""
    print_test("Get AI Business Ideas")
    
    if not test_state["user1_token"] or not test_state["match_id"]:
        print_result(False, "Missing token or match_id")
        return False
    
    success, data = make_request(
        "GET",
        f"/ai/business-ideas/{test_state['match_id']}",
        token=test_state["user1_token"]
    )
    
    if success and "ideas" in data:
        ideas = data["ideas"]
        print_result(True, f"Retrieved {len(ideas)} business ideas", {
            "count": len(ideas),
            "first_idea": ideas[0] if len(ideas) > 0 else None
        })
        return True
    else:
        print_result(False, "Failed to get business ideas", data)
        return False


def run_all_tests():
    """Run all backend tests"""
    print("\n" + "="*60)
    print("COFOUND BACKEND API COMPREHENSIVE TEST SUITE")
    print("="*60)
    
    results = []
    
    # Run tests in sequence
    tests = [
        ("Health Check", test_health_check),
        ("User Registration", test_user_registration),
        ("User Login", test_user_login),
        ("Get Current User", test_get_current_user),
        ("Complete Onboarding", test_complete_onboarding),
        ("Create Second User", test_create_second_user),
        ("Complete Second User Onboarding", test_complete_second_user_onboarding),
        ("Discovery Cards", test_discovery_cards),
        ("User 1 Swipes Right", test_swipe_user1_on_user2),
        ("User 2 Swipes Right", test_swipe_user2_on_user1),
        ("Get Matches User 1", test_get_matches_user1),
        ("Get Matches User 2", test_get_matches_user2),
        ("Get Chat Messages", test_get_chat_messages),
        ("Send Chat Message", test_send_chat_message),
        ("Create Project", test_create_project),
        ("Get Projects", test_get_projects),
        ("Create Deal Room", test_create_deal_room),
        ("Generate Roadmap", test_generate_roadmap),
        ("Get Business Ideas", test_get_business_ideas),
    ]
    
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print_result(False, f"Test crashed: {str(e)}")
            results.append((test_name, False))
    
    # Print summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    print("\n" + "="*60)
    print(f"TOTAL: {passed}/{total} tests passed ({passed*100//total}%)")
    print("="*60)
    
    return results


if __name__ == "__main__":
    run_all_tests()
