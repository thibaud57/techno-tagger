import { bootstrapApplication } from "@angular/platform-browser"

import { AppComponent } from "./app/app.component"
import { demoConfig } from "./app/demo/demo.config"

bootstrapApplication(AppComponent, demoConfig).catch((err: unknown) => {
  console.error(err)
})
