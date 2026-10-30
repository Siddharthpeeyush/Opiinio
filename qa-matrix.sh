#!/bin/bash
# Opiinio live functional matrix — runs against the production API.
# Two QA users are created via the Supabase dashboard (auto-confirmed).
# Usage: API=https://opiinio.netlify.app ./qa-matrix.sh
set -u
API="${API:-https://opiinio.netlify.app}"
PASS=0; FAIL=0
step() { # $1=name $2=expected_http $3=actual_http $4=body
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS $1 (http $3)";
  else FAIL=$((FAIL+1)); echo "FAIL $1 (want $2, got $3) :: $(echo "$4" | head -c 200)"; fi
}
call() { # $1=method $2=path $3=token $4=data -> prints "http|body"
  local m="$1" p="$2" t="$3" d="${4:-}"
  local args=(-s -w "\n%{http_code}" --max-time 30 -X "$m" "$API$p" -H "Content-Type: application/json")
  [ -n "$t" ] && args+=(-H "Authorization: Bearer $t")
  [ -n "$d" ] && args+=(-d "$d")
  local out; out=$(curl "${args[@]}")
  local code; code=$(echo "$out" | tail -1)
  local body; body=$(echo "$out" | sed '$d')
  echo "${code}|${body}"
}
split() { echo "$1" | cut -d'|' -f1; }
sbody() { echo "$1" | cut -d'|' -f2-; }
jqget() { echo "$2" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d.get('data',d); print(v$1)" 2>/dev/null; }

echo "=== 1. sign in both QA users ==="
R=$(call POST /api/auth/signin "" '{"email":"qa-tester-1@opiinio.test","password":"QaTest1234!@#$"}')
step "u1 signin" 200 "$(split "$R")" "$(sbody "$R")"
T1=$(jqget "['session']['accessToken']" "$(sbody "$R")")
R=$(call POST /api/auth/signin "" '{"email":"qa-tester-2@opiinio.test","password":"QaTest1234!@#$"}')
step "u2 signin" 200 "$(split "$R")" "$(sbody "$R")"
T2=$(jqget "['session']['accessToken']" "$(sbody "$R")")
[ -z "$T1" ] || [ -z "$T2" ] && { echo "ABORT: no tokens"; exit 1; }

echo "=== 2. u1 posts opinion ==="
R=$(call POST /api/opinions "$T1" '{"body":"QA test opinion: text only, no media, 280 chars max. The quick brown fox.","topic":"General"}')
step "post opinion" 201 "$(split "$R")" "$(sbody "$R")"
OP=$(jqget "['id']" "$(sbody "$R")")

echo "=== 3. stance vote / unvote ==="
R=$(call POST /api/opinions/$OP/stance "$T1" '{"stance":"agree"}')
step "vote agree" 200 "$(split "$R")" "$(sbody "$R")"
R=$(call POST /api/opinions/$OP/stance "$T1" '{"stance":"disagree"}')
step "change to disagree" 200 "$(split "$R")" "$(sbody "$R")"
R=$(call DELETE /api/opinions/$OP/stance "$T1")
step "unvote" 204 "$(split "$R")" "$(sbody "$R")"

echo "=== 4. like / unlike ==="
R=$(call POST /api/opinions/$OP/like "$T1")
step "like" 204 "$(split "$R")" "$(sbody "$R")"
R=$(call DELETE /api/opinions/$OP/like "$T1")
step "unlike" 204 "$(split "$R")" "$(sbody "$R")"

echo "=== 5. u2 replies (debate mode) ==="
R=$(call POST /api/opinions/$OP/replies "$T2" '{"body":"QA counter-argument: focus beats freedom when deadlines loom.","side":"against"}')
step "u2 reply against" 201 "$(split "$R")" "$(sbody "$R")"
RP=$(jqget "['id']" "$(sbody "$R")")
R=$(call POST /api/replies/$RP/like "$T1")
step "u1 likes reply (voice score)" 204 "$(split "$R")" "$(sbody "$R")"

echo "=== 6. poll (u1 creates, u2 votes, u2 undoes) ==="
R=$(call POST /api/opinions/$OP/polls "$T1" '{"options":["Red","Blue","Green"]}')
step "create poll" 201 "$(split "$R")" "$(sbody "$R")"
POLL=$(jqget "['id']" "$(sbody "$R")")
OPT=$(echo "$(sbody "$R")" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['options'][0]['id'])")
R=$(call POST /api/polls/$POLL/votes "$T2" "{\"option_id\":\"$OPT\"}")
step "u2 votes" 200 "$(split "$R")" "$(sbody "$R")"
R=$(call POST /api/polls/$POLL/votes "$T2" "{\"option_id\":\"$OPT\"}")
[ "$(split "$R")" = "200" ] && { FAIL=$((FAIL+1)); echo "FAIL double vote allowed (want rejection)"; } || { PASS=$((PASS+1)); echo "PASS double vote rejected (http $(split "$R"))"; }
R=$(call DELETE /api/polls/$POLL/votes "$T2")
step "u2 undoes vote" 204 "$(split "$R")" "$(sbody "$R")"

echo "=== 7. repost with quote ==="
R=$(call POST /api/opinions/$OP/reposts "$T2" '{"quote_take":"QA quote: exactly my thoughts, plus data."}')
step "u2 quote repost" 201 "$(split "$R")" "$(sbody "$R")"

echo "=== 8. bookmarks ==="
R=$(call POST /api/bookmarks "$T1" "{\"opinion_id\":\"$OP\"}")
step "bookmark add" 204 "$(split "$R")" "$(sbody "$R")"
R=$(call GET /api/bookmarks "$T1")
step "bookmark list" 200 "$(split "$R")" "$(sbody "$R")"
R=$(call DELETE /api/bookmarks/$OP "$T1")
step "bookmark remove" 204 "$(split "$R")" "$(sbody "$R")"

echo "=== 9. follow / unfollow + notifications ==="
U1=$(jqget "['user']['id']" "$(sbody "$(call GET /api/auth/session "$T1")")")
R=$(call POST /api/follows "$T2" "{\"following_id\":\"$U1\"}")
step "u2 follows u1" 204 "$(split "$R")" "$(sbody "$R")"
R=$(call GET /api/notifications "$T1")
step "u1 notifications" 200 "$(split "$R")" "$(sbody "$R")"
NCOUNT=$(echo "$(sbody "$R")" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['data']['items']))")
[ "$NCOUNT" -ge 3 ] && { PASS=$((PASS+1)); echo "PASS notifications received ($NCOUNT >= 3)"; } || { FAIL=$((FAIL+1)); echo "FAIL notifications only $NCOUNT (want >=3)"; }
NID=$(echo "$(sbody "$R")" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['items'][0]['id'])")
R=$(call PATCH /api/notifications/$NID "$T1" '{"is_read":true}')
step "mark notification read" 200 "$(split "$R")" "$(sbody "$R")"
R=$(call DELETE /api/follows/$U1 "$T2")
step "u2 unfollows u1" 204 "$(split "$R")" "$(sbody "$R")"

echo "=== 10. profile ==="
R=$(call GET /api/profiles/$U1 "$T1")
step "get profile" 200 "$(split "$R")" "$(sbody "$R")"
R=$(call PATCH /api/profiles/$U1 "$T1" '{"display_name":"QA Tester One","bio":"QA bio: testing Opiinio."}')
step "update profile" 200 "$(split "$R")" "$(sbody "$R")"
R=$(call GET /api/profiles/$U1/opinions "$T1")
step "profile opinions" 200 "$(split "$R")" "$(sbody "$R")"

echo "=== 11. respect filter (mute word, report) ==="
R=$(call POST /api/muted-words "$T1" '{"word":"qa-spam-word"}')
step "mute word" 204 "$(split "$R")" "$(sbody "$R")"
R=$(call POST /api/reports "$T1" "{\"opinion_id\":\"$OP\",\"reason\":\"QA test report - please ignore\"}")
step "report opinion" 201 "$(split "$R")" "$(sbody "$R")"

echo "=== 12. search + daily questions ==="
R=$(call GET "/api/opinions?search=quick%20brown%20fox" "$T1")
step "search" 200 "$(split "$R")" "$(sbody "$R")"
R=$(call GET /api/daily-questions "$T1")
step "daily questions" 200 "$(split "$R")" "$(sbody "$R")"

echo "=== 13. cleanup: delete QA opinion, sign out ==="
R=$(call DELETE /api/opinions/$OP "$T1")
step "delete QA opinion" 204 "$(split "$R")" "$(sbody "$R")"
R=$(call POST /api/auth/signout "$T1")
step "u1 signout" 200 "$(split "$R")" "$(sbody "$R")"
R=$(call POST /api/auth/signout "$T2")
step "u2 signout" 200 "$(split "$R")" "$(sbody "$R")"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
exit $FAIL
