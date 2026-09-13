# Application layouts

Layouts own page chrome and route outlets. `MainLayout` owns the product shell;
the documentation feature owns its separate Docs shell. Feature pages should not
recreate either layout or decide how global navigation works.
