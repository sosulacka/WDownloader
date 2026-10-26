import { createContext, useContext, type ComponentType } from "react";
import type { IconProps } from "@keyline-icons/react";
import * as R from "@keyline-icons/react";
import * as S from "@keyline-icons/react/sharp";
import * as T from "@keyline-icons/react/two-tone";
import * as ST from "@keyline-icons/react/sharp/two-tone";
import type { IconStyle } from "../lib/appearance";

export type IconSettings = { style: IconStyle; stroke: number };

export const IconContext = createContext<IconSettings>({
  style: "round",
  stroke: 1.75,
});

type Glyph = ComponentType<IconProps>;

// Статический доступ R.Name позволяет сборщику оставить только нужные иконки.
function icon(
  name: string,
  round: Glyph,
  sharp: Glyph,
  duo: Glyph,
  sharpDuo: Glyph,
) {
  const variants: Record<IconStyle, Glyph> = {
    round,
    sharp,
    duo,
    "sharp-duo": sharpDuo,
  };
  function Icon(props: IconProps) {
    const { style, stroke } = useContext(IconContext);
    const Component = variants[style];
    return <Component strokeWidth={stroke} {...props} />;
  }
  Icon.displayName = name;
  return Icon;
}

export const ArrowDown = icon("ArrowDown", R.ArrowDown, S.ArrowDown, T.ArrowDown, ST.ArrowDown);
export const ArrowRight = icon("ArrowRight", R.ArrowRight, S.ArrowRight, T.ArrowRight, ST.ArrowRight);
export const ArrowUpRight = icon("ArrowUpRight", R.ArrowUpRight, S.ArrowUpRight, T.ArrowUpRight, ST.ArrowUpRight);
export const Bin2 = icon("Bin2", R.Bin2, S.Bin2, T.Bin2, ST.Bin2);
export const Check = icon("Check", R.Check, S.Check, T.Check, ST.Check);
export const ChevronDown = icon("ChevronDown", R.ChevronDown, S.ChevronDown, T.ChevronDown, ST.ChevronDown);
export const ChevronRight = icon("ChevronRight", R.ChevronRight, S.ChevronRight, T.ChevronRight, ST.ChevronRight);
export const CircleAlert = icon("CircleAlert", R.CircleAlert, S.CircleAlert, T.CircleAlert, ST.CircleAlert);
export const CircleCheck = icon("CircleCheck", R.CircleCheck, S.CircleCheck, T.CircleCheck, ST.CircleCheck);
export const CircleHalf = icon("CircleHalf", R.CircleHalf, S.CircleHalf, T.CircleHalf, ST.CircleHalf);
export const ClipboardCopy = icon("ClipboardCopy", R.ClipboardCopy, S.ClipboardCopy, T.ClipboardCopy, ST.ClipboardCopy);
export const ClipboardPaste = icon("ClipboardPaste", R.ClipboardPaste, S.ClipboardPaste, T.ClipboardPaste, ST.ClipboardPaste);
export const Clock = icon("Clock", R.Clock, S.Clock, T.Clock, ST.Clock);
export const Download = icon("Download", R.Download, S.Download, T.Download, ST.Download);
export const Folder = icon("Folder", R.Folder, S.Folder, T.Folder, ST.Folder);
export const FolderOpen = icon("FolderOpen", R.FolderOpen, S.FolderOpen, T.FolderOpen, ST.FolderOpen);
export const Fullscreen = icon("Fullscreen", R.Fullscreen, S.Fullscreen, T.Fullscreen, ST.Fullscreen);
export const HardDrive = icon("HardDrive", R.HardDrive, S.HardDrive, T.HardDrive, ST.HardDrive);
export const Headphones = icon("Headphones", R.Headphones, S.Headphones, T.Headphones, ST.Headphones);
export const Info = icon("Info", R.Info, S.Info, T.Info, ST.Info);
export const Link = icon("Link", R.Link, S.Link, T.Link, ST.Link);
export const LoaderCircle = icon("LoaderCircle", R.LoaderCircle, S.LoaderCircle, T.LoaderCircle, ST.LoaderCircle);
export const Minus = icon("Minus", R.Minus, S.Minus, T.Minus, ST.Minus);
export const Moon = icon("Moon", R.Moon, S.Moon, T.Moon, ST.Moon);
export const Palette = icon("Palette", R.Palette, S.Palette, T.Palette, ST.Palette);
export const Pause = icon("Pause", R.Pause, S.Pause, T.Pause, ST.Pause);
export const Play = icon("Play", R.Play, S.Play, T.Play, ST.Play);
export const Plus = icon("Plus", R.Plus, S.Plus, T.Plus, ST.Plus);
export const Repeat = icon("Repeat", R.Repeat, S.Repeat, T.Repeat, ST.Repeat);
export const RotateCcw = icon("RotateCcw", R.RotateCcw, S.RotateCcw, T.RotateCcw, ST.RotateCcw);
export const Scissors = icon("Scissors", R.Scissors, S.Scissors, T.Scissors, ST.Scissors);
export const Search = icon("Search", R.Search, S.Search, T.Search, ST.Search);
export const Settings = icon("Settings", R.Settings, S.Settings, T.Settings, ST.Settings);
export const SlidersHorizontal = icon("SlidersHorizontal", R.SlidersHorizontal, S.SlidersHorizontal, T.SlidersHorizontal, ST.SlidersHorizontal);
export const Sparkles = icon("Sparkles", R.Sparkles, S.Sparkles, T.Sparkles, ST.Sparkles);
export const Sun = icon("Sun", R.Sun, S.Sun, T.Sun, ST.Sun);
export const Video = icon("Video", R.Video, S.Video, T.Video, ST.Video);
export const Volume = icon("Volume", R.Volume, S.Volume, T.Volume, ST.Volume);
export const VolumeX = icon("VolumeX", R.VolumeX, S.VolumeX, T.VolumeX, ST.VolumeX);
export const X = icon("X", R.X, S.X, T.X, ST.X);
