const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
    { ignores: ["node_modules/**"] },
    js.configs.recommended,
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                ...globals.browser,
                ...globals.node,
                BdApi: "readonly",
                module: "writable"
            }
        },
        rules: {
            "no-unused-vars": ["warn", { args: "none" }],
            "prefer-const": "warn",
            eqeqeq: ["warn", "smart"]
        }
    }
];
