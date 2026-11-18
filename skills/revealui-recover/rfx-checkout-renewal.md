# Renew a reviewed checkout

Use the current installed generation from `.policy.sourceSha256` in `/etc/revealfleet/agents/runtime.json`. Confirm the installed bootstrap and helper's arguments before using this workflow. The bootstrap is at `/usr/local/lib/revkit/agent-runtime/<generation>/bootstrap.sh`.

## Match the evidence

- In the broker policy directory, `review-requests/<digest>.json` binds the request and checkout. Match the Codex role and `request.exportRequest.sourceRoot` to the owner path.
- Find the prior launch context under `launch-contexts` by `binding.outerRequestSha256`. Match the ordered transition receipts from its full runtime policy hash to the current runtime. Vendor evidence is under `updates` and requires the matching completion record. Source evidence is under `source-transitions`. Verify content-addressed identifiers and each policy edge using the installed helper's canonical encoding. A vendor update can change the full policy hash while leaving the source generation intact.
- Use the lineage mode supported by the installed runtime. The verified single-vendor-edge case uses `--runtime-lineage <context-sha> vendor:<receipt-sha>`. If an edge or required completion is missing, recover the evidence through its owning workflow.

## Prepare and complete the renewal

1. Run as the normal operator for the single completed vendor-edge case:

   ```bash
   bash "$bootstrap" --agent-runtime-review prepare-renewal-plan \
     "$prior" --runtime-lineage "$context" "vendor:$receipt"
   ```

   Save the returned packet. The bootstrap provides the read-once owner entry required by the helper.

2. For each prepared packet, read `.packet.command` as a path. Verify the actual file contents against `.packet.commandSha256`, then run the verified script through the maintained workflow. Honor any runtime-required approval. Keep the returned status, review ID, result path, and result SHA-256.
3. Verify the planning result against the returned result hash. Check the admission mode, exact owner source path, and active generation. Read `.admissionRequestSha256` as the admission identifier. Inspect the proposed application before preparing it:

   ```bash
   bash "$bootstrap" --agent-runtime-review inspect-renewal-application \
     "$review" "$result_sha" "$admission"
   ```

4. Use the reviewed capture hash to prepare the application:

   ```bash
   bash "$bootstrap" --agent-runtime-review prepare-renewal-application \
     "$review" "$result_sha" "$admission" "$capture_sha"
   ```

   Verify and run the generated application script as in step 2, then check its result. A prepared packet grants no access.

5. From the exact owner source path, run `rfx --review-admission "$admission"` as the operator with the newly applied admission. Verify the actual checkout and branch after launch.
