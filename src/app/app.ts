import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Tab, TabList, Tabs } from 'primeng/tabs';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Tabs, TabList, Tab],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
