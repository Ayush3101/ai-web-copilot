# ai-web-copilot

AI shopping copilot browser extension + backend analyzer.

## API setup

1. Copy `backend/.env.example` to `backend/.env`.
2. Fill your keys in `backend/.env`:
   - `GROQ_API_KEY`: required for AI analysis.
   - `PRICESAPI_KEY`: required for cross-platform price offers.
   - `COUPONAPI_ENDPOINT`: your coupon feed endpoint URL (provider-specific).
   - `COUPONAPI_KEY`: optional, required if your coupon feed needs auth.
3. Start backend and frontend:
   - Backend: `npm run dev` inside `backend`
   - Frontend extension build/dev: inside `frontend/ai-web-copilot`

## Notes

- Price integration is wired for `PricesAPI` (`https://api.pricesapi.io/api/v1`).
- Coupon integration is endpoint-driven so you can plug any provider by setting `COUPONAPI_ENDPOINT`.
- If an API key/endpoint is missing, the app still works with graceful fallbacks and explanatory source notes.
