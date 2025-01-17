import { Container, Typography } from "@mui/material";
import React, { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { useLayoutStyles } from "../../styles/layout";

const Confirmation: React.FC<{}> = () => {
  const layoutClasses = useLayoutStyles();
  const { t } = useTranslation();

  return (
    <Fragment>
      <Typography variant="h6" className={layoutClasses.header}>
        {t("auth:send_email_confirmation")}
      </Typography>
      <Container className={layoutClasses.content}>
        <Typography>{t("auth:register_email_confirmation")}</Typography>
      </Container>
    </Fragment>
  );
};

export default Confirmation;
