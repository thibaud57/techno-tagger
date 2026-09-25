import { Component, input } from "@angular/core"
import { ArrowRight } from "@primeicons/angular/arrow-right"
import { ChevronLeft } from "@primeicons/angular/chevron-left"
import { ChevronRight } from "@primeicons/angular/chevron-right"
import { Check } from "@primeicons/angular/check"
import { CheckCircle } from "@primeicons/angular/check-circle"
import { Clock } from "@primeicons/angular/clock"
import { ExclamationTriangle } from "@primeicons/angular/exclamation-triangle"
import { Eye } from "@primeicons/angular/eye"
import { EyeSlash } from "@primeicons/angular/eye-slash"
import { File as FileIcon } from "@primeicons/angular/file"
import { Folder } from "@primeicons/angular/folder"
import { Image as ImageIcon } from "@primeicons/angular/image"
import { InfoCircle } from "@primeicons/angular/info-circle"
import { MinusCircle } from "@primeicons/angular/minus-circle"
import { Play } from "@primeicons/angular/play"
import { Stop } from "@primeicons/angular/stop"
import { Times } from "@primeicons/angular/times"
import { TimesCircle } from "@primeicons/angular/times-circle"

/**
 * Les icones reellement utilisees, et non `string` : un nom ouvert imposerait un
 * registre de toutes les icones du paquet, qui annulerait le tree-shaking. Une nouvelle
 * icone = un nom ici, un import, un `@case`. Le tableau existe pour que le test
 * parcoure la liste : Angular ne verifie pas l'exhaustivite d'un `@switch`.
 */
export const ICON_NAMES = [
  "chevron-left",
  "chevron-right",
  "file",
  "folder",
  "image",
  "check",
  "check-circle",
  "clock",
  "minus-circle",
  "play",
  "stop",
  "arrow-right",
  "times",
  "times-circle",
  "exclamation-triangle",
  "info-circle",
  "eye",
  "eye-slash",
] as const
export type IconName = (typeof ICON_NAMES)[number]

/** Les trois tokens de DESIGN.md : `CoreIcon` accepterait n'importe quel nombre. */
export type IconSize = 16 | 20 | 24

/** SVG inline : la taille se pose en width/height, jamais en font-size. */
@Component({
  selector: "app-icon",
  imports: [
    ArrowRight,
    Check,
    CheckCircle,
    ChevronLeft,
    ChevronRight,
    Clock,
    ExclamationTriangle,
    Play,
    Stop,
    Eye,
    EyeSlash,
    FileIcon,
    Folder,
    ImageIcon,
    InfoCircle,
    MinusCircle,
    Times,
    TimesCircle,
  ],
  template: `
    @switch (name()) {
      @case ("chevron-left") {
        <svg data-p-icon="chevron-left" [size]="size()" />
      }
      @case ("chevron-right") {
        <svg data-p-icon="chevron-right" [size]="size()" />
      }
      @case ("file") {
        <svg data-p-icon="file" [size]="size()" />
      }
      @case ("folder") {
        <svg data-p-icon="folder" [size]="size()" />
      }
      @case ("image") {
        <svg data-p-icon="image" [size]="size()" />
      }
      @case ("check") {
        <svg data-p-icon="check" [size]="size()" />
      }
      @case ("check-circle") {
        <svg data-p-icon="check-circle" [size]="size()" />
      }
      @case ("clock") {
        <svg data-p-icon="clock" [size]="size()" />
      }
      @case ("minus-circle") {
        <svg data-p-icon="minus-circle" [size]="size()" />
      }
      @case ("play") {
        <svg data-p-icon="play" [size]="size()" />
      }
      @case ("stop") {
        <svg data-p-icon="stop" [size]="size()" />
      }
      @case ("arrow-right") {
        <svg data-p-icon="arrow-right" [size]="size()" />
      }
      @case ("times") {
        <svg data-p-icon="times" [size]="size()" />
      }
      @case ("times-circle") {
        <svg data-p-icon="times-circle" [size]="size()" />
      }
      @case ("exclamation-triangle") {
        <svg data-p-icon="exclamation-triangle" [size]="size()" />
      }
      @case ("info-circle") {
        <svg data-p-icon="info-circle" [size]="size()" />
      }
      @case ("eye") {
        <svg data-p-icon="eye" [size]="size()" />
      }
      @case ("eye-slash") {
        <svg data-p-icon="eye-slash" [size]="size()" />
      }
    }
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>()
  readonly size = input<IconSize>(20)
}
