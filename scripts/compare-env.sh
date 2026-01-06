#!/bin/bash

# Script to compare local .env.local with Vercel production environment variables
# Compatible with bash 3.2 (macOS default)

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

VERCEL_ENV_FILE=".env.vercel.production"
LOCAL_ENV_FILE=".env.local"
REPORT_FILE="docs/vercel-env-audit.md"
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

echo "🔍 MileKeeper Environment Variables Audit"
echo "=========================================="
echo ""

# Step 1: Check Vercel CLI
echo "Step 1: Checking Vercel CLI..."
if ! command -v vercel &> /dev/null && ! command -v npx &> /dev/null; then
    echo "❌ Vercel CLI not found. Please install it:"
    echo "   npm install -g vercel"
    exit 1
fi

VERCEL_CMD="npx vercel"
echo "✓ Using: $VERCEL_CMD"
echo ""

# Step 2: Check login status
echo "Step 2: Checking Vercel login status..."
WHOAMI_OUTPUT=$($VERCEL_CMD whoami 2>&1 || true)
if echo "$WHOAMI_OUTPUT" | grep -q "No existing credentials\|not logged in"; then
    echo "⚠️  Not logged in to Vercel."
    echo "   Please run: $VERCEL_CMD login"
    echo "   Then run this script again."
    exit 1
fi

USER_EMAIL=$(echo "$WHOAMI_OUTPUT" | grep -v "Vercel CLI" | grep -v "NOTE:" | grep -v "telemetry" | head -1 | xargs)
if [ -z "$USER_EMAIL" ]; then
    USER_EMAIL="unknown"
fi
echo "✓ Logged in as: $USER_EMAIL"
echo ""

# Step 3: Check project link
echo "Step 3: Checking project link..."
if [ ! -d ".vercel" ]; then
    echo "⚠️  Project not linked to Vercel."
    echo "   Please run: $VERCEL_CMD link"
    echo "   Then run this script again."
    exit 1
fi
echo "✓ Project is linked"
echo ""

# Step 4: Pull production environment variables
echo "Step 4: Pulling production environment variables..."
if [ -f "$VERCEL_ENV_FILE" ]; then
    rm "$VERCEL_ENV_FILE"
fi

PULL_OUTPUT=$($VERCEL_CMD env pull "$VERCEL_ENV_FILE" --environment=production 2>&1 || true)
if echo "$PULL_OUTPUT" | grep -qi "error\|failed"; then
    echo "❌ Failed to pull environment variables from Vercel"
    echo "$PULL_OUTPUT" | grep -v "Vercel CLI" | grep -v "NOTE:"
    exit 1
fi

if [ ! -f "$VERCEL_ENV_FILE" ]; then
    echo "❌ Environment file was not created"
    exit 1
fi

echo "✓ Downloaded to: $VERCEL_ENV_FILE"
echo ""

# Step 5: Check local .env.local exists
echo "Step 5: Checking local environment file..."
if [ ! -f "$LOCAL_ENV_FILE" ]; then
    echo "❌ Local environment file not found: $LOCAL_ENV_FILE"
    exit 1
fi
echo "✓ Found: $LOCAL_ENV_FILE"
echo ""

# Step 6: Parse and compare
echo "Step 6: Comparing environment variables..."
echo ""

# Function to mask value (first 6 chars + *** + last 4 chars)
mask_value() {
    local value="$1"
    local len=${#value}
    if [ $len -le 10 ]; then
        echo "***"
    else
        echo "${value:0:6}***${value:$(($len-4))}"
    fi
}

# Function to extract project ref from Supabase URL
extract_project_ref() {
    local url="$1"
    if echo "$url" | grep -qE 'https://([^.]+)\.supabase\.co'; then
        echo "$url" | sed -E 's|https://([^.]+)\.supabase\.co|\1|'
    else
        echo "unknown"
    fi
}

# Function to get value for a key from env file
get_value() {
    local file="$1"
    local key="$2"
    grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" 2>/dev/null | head -1 | sed 's/^[^=]*=[[:space:]]*//' | xargs || echo ""
}

# Parse local env into temp file (key=value format)
LOCAL_KEYS_FILE="$TMP_DIR/local_keys.txt"
VERCEL_KEYS_FILE="$TMP_DIR/vercel_keys.txt"

while IFS='=' read -r key value || [ -n "$key" ]; do
    # Skip empty lines and comments
    if [[ -z "$key" ]] || [[ "$key" =~ ^[[:space:]]*# ]]; then
        continue
    fi
    # Remove leading/trailing whitespace
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs)
    if [ -n "$key" ]; then
        echo "$key=$value" >> "$LOCAL_KEYS_FILE"
    fi
done < "$LOCAL_ENV_FILE"

while IFS='=' read -r key value || [ -n "$key" ]; do
    # Skip empty lines and comments
    if [[ -z "$key" ]] || [[ "$key" =~ ^[[:space:]]*# ]]; then
        continue
    fi
    # Remove leading/trailing whitespace
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs)
    if [ -n "$key" ]; then
        echo "$key=$value" >> "$VERCEL_KEYS_FILE"
    fi
done < "$VERCEL_ENV_FILE"

# Count variables
LOCAL_COUNT=$(wc -l < "$LOCAL_KEYS_FILE" | xargs)
VERCEL_COUNT=$(wc -l < "$VERCEL_KEYS_FILE" | xargs)

# Find missing and differences
MISSING_IN_VERCEL=()
MISSING_IN_LOCAL=()
DIFFERENCES=()
MATCHES=0

while IFS='=' read -r key value; do
    vercel_value=$(get_value "$VERCEL_KEYS_FILE" "$key")
    if [ -z "$vercel_value" ]; then
        MISSING_IN_VERCEL+=("$key")
    elif [ "$value" != "$vercel_value" ]; then
        DIFFERENCES+=("$key")
    else
        ((MATCHES++))
    fi
done < "$LOCAL_KEYS_FILE"

while IFS='=' read -r key value; do
    local_value=$(get_value "$LOCAL_KEYS_FILE" "$key")
    if [ -z "$local_value" ]; then
        MISSING_IN_LOCAL+=("$key")
    fi
done < "$VERCEL_KEYS_FILE"

# Generate report
mkdir -p docs
{
    echo "# Vercel Environment Variables Audit"
    echo ""
    echo "**Generated:** $(date)"
    echo "**Project:** MileKeeper"
    echo "**Environment:** Production"
    echo ""
    echo "## Summary"
    echo ""
    echo "- **Variables in local:** $LOCAL_COUNT"
    echo "- **Variables in Vercel:** $VERCEL_COUNT"
    echo "- **Matching:** $MATCHES"
    echo "- **Different:** ${#DIFFERENCES[@]}"
    echo "- **Missing in Vercel:** ${#MISSING_IN_VERCEL[@]}"
    echo "- **Missing in local:** ${#MISSING_IN_LOCAL[@]}"
    echo ""
    echo "## Variables Missing in Vercel"
    echo ""
    if [ ${#MISSING_IN_VERCEL[@]} -eq 0 ]; then
        echo "✅ All local variables are present in Vercel"
    else
        for key in "${MISSING_IN_VERCEL[@]}"; do
            value=$(get_value "$LOCAL_KEYS_FILE" "$key")
            masked=$(mask_value "$value")
            echo "- \`$key\` = \`$masked\`"
        done
    fi
    echo ""
    echo "## Variables Missing in Local"
    echo ""
    if [ ${#MISSING_IN_LOCAL[@]} -eq 0 ]; then
        echo "✅ All Vercel variables are present locally"
    else
        for key in "${MISSING_IN_LOCAL[@]}"; do
            value=$(get_value "$VERCEL_KEYS_FILE" "$key")
            masked=$(mask_value "$value")
            echo "- \`$key\` = \`$masked\`"
        done
    fi
    echo ""
    echo "## Variables with Different Values"
    echo ""
    if [ ${#DIFFERENCES[@]} -eq 0 ]; then
        echo "✅ All matching variables have the same values"
    else
        echo "| Variable | Local (masked) | Vercel (masked) |"
        echo "|----------|----------------|-----------------|"
        for key in "${DIFFERENCES[@]}"; do
            local_value=$(get_value "$LOCAL_KEYS_FILE" "$key")
            vercel_value=$(get_value "$VERCEL_KEYS_FILE" "$key")
            local_masked=$(mask_value "$local_value")
            vercel_masked=$(mask_value "$vercel_value")
            echo "| \`$key\` | \`$local_masked\` | \`$vercel_masked\` |"
        done
    fi
    echo ""
    echo "## Supabase Project Reference Check"
    echo ""
    local_supabase_url=$(get_value "$LOCAL_KEYS_FILE" "NEXT_PUBLIC_SUPABASE_URL")
    vercel_supabase_url=$(get_value "$VERCEL_KEYS_FILE" "NEXT_PUBLIC_SUPABASE_URL")
    if [ -n "$local_supabase_url" ] && [ -n "$vercel_supabase_url" ]; then
        local_ref=$(extract_project_ref "$local_supabase_url")
        vercel_ref=$(extract_project_ref "$vercel_supabase_url")
        echo "- **Local project ref:** \`$local_ref\`"
        echo "- **Vercel project ref:** \`$vercel_ref\`"
        if [ "$local_ref" == "$vercel_ref" ]; then
            echo "- **Status:** ✅ Both point to the same Supabase project"
        else
            echo "- **Status:** ⚠️  **MISMATCH** - Different Supabase projects!"
        fi
    else
        echo "⚠️  Could not check Supabase project reference (NEXT_PUBLIC_SUPABASE_URL missing)"
    fi
    echo ""
    echo "## All Variables (Local)"
    echo ""
    echo "| Variable | Value (masked) |"
    echo "|----------|----------------|"
    sort "$LOCAL_KEYS_FILE" | while IFS='=' read -r key value; do
        masked=$(mask_value "$value")
        echo "| \`$key\` | \`$masked\` |"
    done
    echo ""
    echo "## All Variables (Vercel Production)"
    echo ""
    echo "| Variable | Value (masked) |"
    echo "|----------|----------------|"
    sort "$VERCEL_KEYS_FILE" | while IFS='=' read -r key value; do
        masked=$(mask_value "$value")
        echo "| \`$key\` | \`$masked\` |"
    done
} > "$REPORT_FILE"

echo "✅ Comparison complete!"
echo ""
echo "📄 Report saved to: $REPORT_FILE"
echo ""

# Print summary to console
echo "=== SUMMARY ==="
echo "Variables in local: $LOCAL_COUNT"
echo "Variables in Vercel: $VERCEL_COUNT"
echo "Matching: $MATCHES"
echo "Different: ${#DIFFERENCES[@]}"
echo "Missing in Vercel: ${#MISSING_IN_VERCEL[@]}"
echo "Missing in local: ${#MISSING_IN_LOCAL[@]}"
echo ""

if [ ${#DIFFERENCES[@]} -gt 0 ]; then
    echo "⚠️  Differences found:"
    for key in "${DIFFERENCES[@]}"; do
        local_value=$(get_value "$LOCAL_KEYS_FILE" "$key")
        vercel_value=$(get_value "$VERCEL_KEYS_FILE" "$key")
        local_masked=$(mask_value "$local_value")
        vercel_masked=$(mask_value "$vercel_value")
        echo "   $key: local=$local_masked vs vercel=$vercel_masked"
    done
    echo ""
fi

if [ -n "$local_supabase_url" ] && [ -n "$vercel_supabase_url" ]; then
    local_ref=$(extract_project_ref "$local_supabase_url")
    vercel_ref=$(extract_project_ref "$vercel_supabase_url")
    if [ "$local_ref" == "$vercel_ref" ]; then
        echo "✅ Supabase project refs match: $local_ref"
    else
        echo "⚠️  Supabase project refs MISMATCH: local=$local_ref vs vercel=$vercel_ref"
    fi
fi

echo ""
echo "📄 Full report: $REPORT_FILE"
