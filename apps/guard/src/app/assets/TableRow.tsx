import { type FC, useMemo, useState } from 'react';

import { AngleDown, AngleUp } from '@rosen-bridge/icons';
import { Amount, Button, EnhancedTableCell, Identifier, TableRow } from '@rosen-bridge/ui-kit';
import { NETWORKS } from '@rosen-ui/constants';
import { getAddressUrl, getTokenUrl } from '@rosen-ui/utils';

import { useAddresses } from '@/hooks';
import type { GuardTokenInfo } from '@/types/api';

export type GuardAssetView = Omit<GuardTokenInfo, 'amount' | 'coldAmount'> & {
  amount: number | bigint;
  coldAmount?: number | bigint;
  hotAddress?: string;
  balanceAddress?: string;
  balanceLabel?: 'Hot' | 'Cold';
  balanceAddressUrl?: string;
  tokenUrl?: string;
};

interface RowProps extends GuardAssetView {
  isLoading?: boolean;
}

export const mobileHeader = [
  {
    title: ' ',
    cellProps: {
      width: '40%',
    },
  },
  {
    title: '  ',
    cellProps: {
      width: '60%',
    },
  },
];

export const tabletHeader = [
  {
    title: 'ID',
    cellProps: {
      width: 200,
    },
  },
  {
    title: 'Token name',
    cellProps: {
      width: 250,
    },
  },
  {
    title: 'Chain',
    cellProps: {
      width: 150,
    },
  },
  {
    title: 'Amount (Hot)',
    cellProps: {
      width: 150,
    },
  },
  {
    title: 'Amount (Cold)',
    cellProps: {
      width: 150,
    },
  },
];

export const custodyTabletHeader = (label: 'Hot' | 'Cold') =>
  tabletHeader
    .slice(0, 4)
    .map((header, index) => (index === 3 ? { ...header, title: `Amount (${label})` } : header));

export const MobileRow: FC<RowProps> = (props) => {
  const { isLoading, ...row } = props;
  const [expand, setExpand] = useState(false);

  const rowStyles = useMemo(() => (isLoading ? { opacity: 0.3 } : {}), [isLoading]);

  const toggleExpand = () => {
    setExpand((prevState) => !prevState);
  };

  return (
    <>
      <TableRow className="divider" style={rowStyles}>
        <EnhancedTableCell>Id</EnhancedTableCell>
        <EnhancedTableCell>
          <Identifier
            href={row.isNativeToken ? undefined : row.tokenUrl}
            value={row.isNativeToken ? '' : row.tokenId}
            fallback="-"
          />
        </EnhancedTableCell>
      </TableRow>
      <TableRow style={rowStyles}>
        <EnhancedTableCell>Token name</EnhancedTableCell>
        <EnhancedTableCell>{row.name}</EnhancedTableCell>
      </TableRow>
      <TableRow style={rowStyles}>
        <EnhancedTableCell>Chain</EnhancedTableCell>
        <EnhancedTableCell>{row.chain}</EnhancedTableCell>
      </TableRow>
      {expand && (
        <>
          <TableRow style={rowStyles}>
            <EnhancedTableCell>Amount ({row.balanceLabel ?? 'Hot'})</EnhancedTableCell>
            <EnhancedTableCell>
              <Amount
                value={row.amount}
                decimal={row.decimals}
                href={
                  row.balanceAddressUrl ??
                  (row.balanceAddress ? getAddressUrl(row.chain, row.balanceAddress) : undefined)
                }
              />
            </EnhancedTableCell>
          </TableRow>
          {!row.balanceLabel && (
            <TableRow style={rowStyles}>
              <EnhancedTableCell>Amount (Cold)</EnhancedTableCell>
              <EnhancedTableCell>
                <Amount value={row.coldAmount} decimal={row.decimals} />
              </EnhancedTableCell>
            </TableRow>
          )}
        </>
      )}
      <TableRow style={rowStyles}>
        <EnhancedTableCell padding="none">
          <Button
            variant="text"
            onClick={toggleExpand}
            style={{ fontSize: 'inherit' }}
            endIcon={expand ? <AngleUp /> : <AngleDown />}
          >
            {expand ? 'Show less' : 'Show more'}
          </Button>
        </EnhancedTableCell>
        <EnhancedTableCell />
      </TableRow>
    </>
  );
};

export const TabletRow: FC<RowProps> = (props) => {
  const { isLoading, ...row } = props;

  const addresses = useAddresses();

  const tokenUrl =
    row.tokenUrl ??
    getTokenUrl(
      row.chain,
      row.chain === NETWORKS.cardano.key ? row.tokenId.replace('.', '') : row.tokenId,
    );

  const rowStyles = useMemo(() => (isLoading ? { opacity: 0.3 } : {}), [isLoading]);

  const coldUrl = getAddressUrl(row.chain, addresses.cold[row?.chain]);

  const hotUrl =
    row.balanceAddressUrl ??
    getAddressUrl(row.chain, row.balanceAddress ?? row.hotAddress ?? addresses.hot[row?.chain]);

  return (
    <TableRow className="divider" style={rowStyles}>
      <EnhancedTableCell>
        <Identifier
          href={row.isNativeToken ? undefined : tokenUrl}
          value={row.isNativeToken ? '' : row.tokenId}
          fallback="-"
          style={{ maxWidth: '100px' }}
        />
      </EnhancedTableCell>
      <EnhancedTableCell>{row.name}</EnhancedTableCell>
      <EnhancedTableCell>{row.chain}</EnhancedTableCell>
      <EnhancedTableCell>
        <Amount
          href={hotUrl}
          value={row.amount}
          decimal={row.decimals}
          style={{ alignItems: 'center' }}
        />
      </EnhancedTableCell>
      {!row.balanceLabel && (
        <EnhancedTableCell>
          <Amount
            href={coldUrl}
            value={row.coldAmount}
            decimal={row.decimals}
            style={{ alignItems: 'center' }}
          />
        </EnhancedTableCell>
      )}
    </TableRow>
  );
};
