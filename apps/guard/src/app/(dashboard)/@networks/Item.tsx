'use client';

import { useMemo } from 'react';

import useSWR from 'swr';

import { Card, CardBody, Divider, Icon, Network, Stack } from '@rosen-bridge/ui-kit';
import { NETWORKS } from '@rosen-ui/constants';
import { fetcher } from '@rosen-ui/swr-helpers';
import type { Network as NetworkType } from '@rosen-ui/types';

import { type GuardBalanceView, guardBalanceReaders } from '@/networks';

import { ItemAddress } from './ItemAddress';

export type ItemProps = {
  network?: NetworkType;
};

export const Item = ({ network }: ItemProps) => {
  const reader = network ? guardBalanceReaders[network] : undefined;

  const key = useMemo(() => {
    if (!network) return;
    if (reader) return reader.key;
    return [
      '/balance',
      {
        tokenId: NETWORKS[network].nativeToken,
      },
    ];
  }, [network, reader]);

  const { data: response, error, isLoading } = useSWR<unknown>(key, fetcher);

  const data = useMemo(() => {
    if (!response) return;
    if (!reader) return response as GuardBalanceView;
    try {
      return reader.decode(response);
    } catch {
      return;
    }
  }, [reader, response]);

  const cold = useMemo(() => {
    return data?.cold.items?.find((item) => item.chain === network);
  }, [data, network]);

  const hot = useMemo(() => {
    return data?.hot.items?.find((item) => item.chain === network);
  }, [data, network]);

  const hasError = useMemo<boolean>(() => {
    return !isLoading && (!network || !cold || !hot || !!error);
  }, [cold, error, hot, isLoading, network]);

  return (
    <Card style={{ userSelect: 'none' }}>
      <CardBody>
        <Stack align="stretch" justify="start" spacing={1}>
          <Network loading={isLoading} value={network} />
          <ItemAddress loading={isLoading} state="hot" value={hot} />
          <Divider variant="full" />
          <ItemAddress loading={isLoading} state="cold" value={cold} />
        </Stack>
      </CardBody>
      {hasError && (
        <div
          style={{
            zIndex: 1,
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <Icon color="warning-dark" name="ExclamationTriangle" opacity="0.075" size="184px" />
        </div>
      )}
    </Card>
  );
};
