#!/usr/bin/env node
"use strict";
// Typed structural TOML editing lives in the shared configuration primitive.
const config = require("../lib/grok-config.mts");
config.main();
module.exports = config;
