import { defineConfig } from "wxt";

export default defineConfig({
    manifest: {
        name: "StoryWorthy",
        version: "0.2.0",
        description: "Vote on what kind of story a post or content could become.",
        permissions: [
            "storage",
            "sidePanel",
            "tabs",
        ],
        host_permissions: [
            "https://*/*",
            "http://*/*",
            // "https://www.reddit.com/*",
            // "https://reddit.com/*",
            // "https://x.com/*",
            // "https://api.storyworthy.app/*",
        ],
        icons: {
            "16": "icons/icon-16.png",
            "48": "icons/icon-48.png",
            "128": "icons/icon-128.png",
        },
        side_panel: {
            default_path: "sidepanel.html",
        },
        action: {
            default_title: "Storyworthy",
            default_icon: {
                "16": "icons/icon-16.png",
                "48": "icons/icon-48.png",
                "128": "icons/icon-128.png",
            },
        },
    },
});