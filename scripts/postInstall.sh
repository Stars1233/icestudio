#!/usr/bin/env sh
# Detect correct sed syntax, os and sed version dependant

TEST_FILE=$(mktemp)
echo "test" > "$TEST_FILE"

# Detect correct sed syntax flavour
if sed -i '' -e 's/test/detect/' "$TEST_FILE" 2>/dev/null; then
    SED_CMD="sed -i '' -e"
elif sed -i -e 's/test/detect/' "$TEST_FILE" 2>/dev/null; then
    SED_CMD="sed -i -e"
else
    echo "❌ Sed command not exists or is not compatible"
    rm -f "$TEST_FILE"
    exit 1
fi

# remove test temporal files
rm -f "$TEST_FILE"

$SED_CMD 's/options\.srcDir/\/\/options.srcDir/g' node_modules/grunt-nw-builder/tasks/nw.js

echo "✅ Post install actions succeeded"
