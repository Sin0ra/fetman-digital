# Fetman Digital Website

This repository contains the public-facing Fetman Digital website.

## Contents

- `index.html` - Main website
- `maintenance.html` - Maintenance page
- `Branding img/` - Branding assets
- `logo img/` - Logo assets
- Image files in the project root - Website imagery
- `*-480.jpg` and `*-1200.jpg` files in the image folders - Responsive portfolio derivatives; the original artwork is retained
- `Fetman Digital website background-optimized-*.jpg` - Responsive, compressed hero backgrounds
- `_headers` - Netlify cache policy for static images; HTML is not given a long-lived cache rule

## Running locally

Open `index.html` in a web browser.

For more reliable local testing, serve the project directory using a static HTTP server or a development server that does not require a backend.

## Deployment

Deploy the website files and their required assets to a static hosting provider.

Ensure that the HTML, images, CSS, JavaScript, and other referenced assets are uploaded with their original relative paths.

## Architecture

This project is intended to serve the public website only.

It does not include the former management portal, management API, application server, or management database setup scripts.
