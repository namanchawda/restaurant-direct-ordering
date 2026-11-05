Client

Company A, Hyderabad. Biryani and Hyderabadi food chain with 14 outlets and 3 cloud kitchens. 520 staff, revenue ₹90–105 crore a year, 55% of it through food delivery apps.

Today

Delivery apps charge 25–30% in commission and fees. A phone line takes bulk and party orders. Each outlet's billing system is separate, menus and prices are updated by hand on every app, and the brand owns no customer data. Kitchens work from printed tickets.

The problem

Assumptions: app sales are 55% of ₹96 crore = ₹52.8 crore at 27% average commission. Moving 12% of that to direct orders, where delivery and payment costs are 12%, saves 15 points on ₹6.336 crore = ₹95.04 lakh. The phone line loses 30 bulk orders a month at ₹18,000 and 30% margin: 30 × ₹5,400 × 12 = ₹19.44 lakh. Total ₹1.14 crore a year.

Users

Customers (mobile), outlet managers and kitchen staff, and the central marketing team. The founder-CEO signs the deal.

The ask

I pay the apps a quarter of every order and they own my customers. I want our own ordering site that is faster and nicer than the apps, with one menu and prices I control. Orders should go straight to the right outlet's kitchen screen. Regulars should earn rewards for ordering direct, and party orders should be easy to place.

Must have

Ordering web app: outlet picked by location and delivery radius, menu with photos, add-ons and portions, cart, coupons, UPI and card payment (test mode), and live order status
Central menu CMS: items, prices by city, outlet availability, time-based menus, photos, veg and non-veg marks, spice level
Kitchen display per outlet: new orders with timers, prep stages, ready for pickup, and rider handoff
Loyalty points on direct orders, redeemed at checkout
Party order form with minimum notice and confirmation by the catering manager
Dashboard of orders, prep time, cancellations and repeat customers by outlet
Core build

Software Engineering candidates must ship this slice end to end, in about 6 to 8 screens: ordering web app with menu and cart, test payment, central menu admin, and outlet kitchen display. Roles: customer and kitchen staff. AI: prep-time estimate. Hard part: real-time order updates on the kitchen screen. Mock payments, messages and outside systems, and seed from the sample data. The rest of MUST HAVE is optional depth.

Out of scope

Delivery app integration
An own rider app (riders come from a delivery partner)
Replacing outlet billing or inventory
Ai or automation

Orders route to the right outlet automatically, status updates go out by WhatsApp or SMS, and items pause when an outlet marks them out of stock. AI suggests reorders from each customer's history and predicts prep time from current kitchen load, so the promised time is honest. When it is wrong: suggestions never add items to the cart; the promised time is the higher of the AI estimate and the outlet's minimum; an order 10 minutes past its promise alerts the outlet manager and updates the customer; managers can override estimates.

Constraints

Show each outlet's FSSAI licence number, veg and non-veg symbols and allergens. Prices include 5% GST and must say so. Customer data is personal data under the DPDP Act 2023; marketing messages need opt-in. Friday and Sunday dinner peaks reach 1,200 orders an hour across outlets. Kitchens use cheap Android tablets in hot, noisy spaces.

Design

The client values good, minimal design: clean layouts, white space, a restrained palette and clear type, with nothing on screen that lacks a purpose. Design counts as much as features. The menu should make people hungry: big food photos, a short scannable menu, easy-to-read prices and checkout in under a minute. The kitchen screen must be readable from two metres, with colour marking late orders.

Budget and time

₹9 lakh, 8 weeks. Success: direct orders equal to 12% of app orders within 9 months; median checkout under 60 seconds; 35% of direct customers ordering again within a month by month 6.

Sample data

Order ID	Outlet	Items	Total ₹	Payment	Placed	Promised	Status
WEB-778120	Kondapur	Chicken dum biryani family pack x1, Double ka meetha x2	1180	UPI	20:14	20:59	Preparing
WEB-778131	Gachibowli cloud kitchen	Veg biryani x2, Mirchi ka salan x1	640	Card	20:21	21:01	Ready for pickup
WEB-778146	Kukatpally	Mutton haleem x3	1050	UPI	20:26	21:16	Late by 4 minutes
