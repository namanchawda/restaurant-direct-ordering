# Project instructions

- **Environment:** Windows. Use PowerShell-compatible commands and `.venv\Scripts\python`.
- **UI design:** Before any UI task, always read `.github/skills/apple-design-skill/SKILL.md` and, when relevant, the files in its `references` folder. Follow the skill. Keep the design minimal: use white space, a restrained palette, clear type, and put nothing on screen without a purpose.
- **UI verification:** After every UI change, use the Playwright MCP tools to open the page, take screenshots at mobile (390px) and desktop widths, check for console errors, and fix what you see before reporting completion. Check the kitchen screen at 1280x800 (tablet landscape).
- **Prices:** Use INR and show prices as inclusive of 5% GST with the exact text `incl. 5% GST`.
- **Food information:** Show the FSSAI number, veg/non-veg symbols, and relevant allergens.
- **Privacy:** Customer data is personal data under the DPDP Act. Collect the minimum data needed. Do not send marketing without explicit opt-in via an unchecked-by-default checkbox.
- **Payments:** Payments are mocked. Never integrate real payment keys.
- **Kitchen display:** Use large, high-contrast type readable from 2 metres; mark late orders with color and text; support inexpensive Android tablets without heavy animation.
- **Secrets:** Never commit secrets. Use `.env` files and provide a corresponding `.env.example`.
- **Scope:** Keep implementation aligned with the brief's Core build slice; favor simple solutions suitable for the 8-week budget.
