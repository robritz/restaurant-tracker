"use client";

import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import { Fragment } from "react";
import type { PlaceLogSummary } from "@/app/api/place-logs/route";

function dishes(count: number): string {
  return count === 1 ? "1 dish" : `${count} dishes`;
}

function capturedOn(capturedAt: string): string {
  return new Date(capturedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Every Place you've eaten at, most recently captured first. This is what
 * the panel shows when no pin is selected -- and the reliable way to reach
 * a Place that's hard to hit as a small pin on a phone.
 */
export default function PlaceLogList({
  placeLogs,
  onSelect,
}: {
  placeLogs: PlaceLogSummary[];
  onSelect: (id: string) => void;
}) {
  return (
    <List disablePadding>
      {placeLogs.map((placeLog, index) => (
        <Fragment key={placeLog.id}>
          {index > 0 && <Divider component="li" />}
          <ListItem disablePadding>
            <ListItemButton onClick={() => onSelect(placeLog.id)}>
              <ListItemText
                primary={placeLog.name}
                secondary={
                  <>
                    <Typography variant="body2" component="span" display="block">
                      {placeLog.address}
                    </Typography>
                    <Typography variant="caption" component="span">
                      {dishes(placeLog.entry_count)} ·{" "}
                      {capturedOn(placeLog.last_captured_at)}
                    </Typography>
                  </>
                }
              />
            </ListItemButton>
          </ListItem>
        </Fragment>
      ))}
    </List>
  );
}
